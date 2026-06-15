import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { asyncHandler, requireAdmin, requireAuth } from "../middleware.js";
import { createSessionToken, hashSessionToken } from "../security.js";
import {
  adminUserUpdateSchema,
  invitationSchema,
  validate
} from "../validation.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAdminRouter({ pool, config }) {
  const router = Router();
  const inviteLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Demasiadas invitaciones. Intenta mas tarde." }
  });

  router.use(requireAuth(pool), requireAdmin());

  router.get("/overview", asyncHandler(async (request, response) => {
    const [users, invitations] = await Promise.all([
      pool.query(
        `SELECT id, name, username, email, role, is_active, email_verified_at,
                created_at, updated_at
         FROM users
         ORDER BY created_at ASC`
      ),
      pool.query(
        `SELECT i.id, i.email, i.role, i.expires_at, i.accepted_at, i.delivered_at,
                i.revoked_at,
                i.created_at, u.username AS invited_by_username
         FROM user_invitations i
         JOIN users u ON u.id = i.invited_by
         ORDER BY i.created_at DESC
         LIMIT 100`
      )
    ]);
    response.json({
      users: users.rows.map(mapUser),
      invitations: invitations.rows.map(mapInvitation)
    });
  }));

  router.post("/invitations", inviteLimiter, asyncHandler(async (request, response) => {
    const invitation = validate(invitationSchema, request.body);
    const existing = await pool.query(
      "SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)",
      [invitation.email]
    );
    if (existing.rowCount) {
      return response.status(409).json({ error: "Ya existe una cuenta con ese correo." });
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + invitation.expirationDays * 86_400_000);
    const client = await pool.connect();
    let created;
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE user_invitations SET revoked_at = NOW()
         WHERE LOWER(email) = LOWER($1)
           AND accepted_at IS NULL AND revoked_at IS NULL`,
        [invitation.email]
      );
      const result = await client.query(
        `INSERT INTO user_invitations
           (email, role, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, role, expires_at, accepted_at, delivered_at,
                   revoked_at, created_at`,
        [
          invitation.email,
          invitation.role,
          hashSessionToken(token),
          request.user.id,
          expiresAt
        ]
      );
      created = result.rows[0];
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const inviteUrl = `${config.appOrigin}/?invite=${encodeURIComponent(token)}`;
    let delivered = false;
    let deliveryError = null;
    try {
      delivered = await sendInvitationEmail(config, invitation.email, inviteUrl, expiresAt);
      if (delivered) {
        await pool.query(
          "UPDATE user_invitations SET delivered_at = NOW() WHERE id = $1",
          [created.id]
        );
        created.delivered_at = new Date();
      }
    } catch {
      deliveryError = "No se pudo enviar el correo. Comparte el enlace manualmente.";
    }
    response.status(201).json({
      invitation: mapInvitation(created),
      inviteUrl,
      delivered,
      deliveryError
    });
  }));

  router.delete("/invitations/:id", asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      return response.status(400).json({ error: "Identificador de invitacion invalido." });
    }
    const result = await pool.query(
      `UPDATE user_invitations SET revoked_at = NOW()
       WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
       RETURNING id`,
      [request.params.id]
    );
    if (!result.rowCount) {
      return response.status(404).json({ error: "La invitacion ya no esta activa." });
    }
    response.status(204).end();
  }));

  router.patch("/users/:id", asyncHandler(async (request, response) => {
    if (!UUID_PATTERN.test(request.params.id)) {
      return response.status(400).json({ error: "Identificador de usuario invalido." });
    }
    const update = validate(adminUserUpdateSchema, request.body);
    if (request.params.id === request.user.id &&
        (update.role !== "admin" || update.isActive !== true)) {
      return response.status(400).json({
        error: "No puedes quitar tus propios permisos ni desactivar tu cuenta."
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        "SELECT id, role, is_active FROM users WHERE id = $1 FOR UPDATE",
        [request.params.id]
      );
      if (!target.rowCount) {
        await client.query("ROLLBACK");
        return response.status(404).json({ error: "Usuario no encontrado." });
      }
      const removesActiveAdmin = target.rows[0].role === "admin" &&
        target.rows[0].is_active &&
        (update.role !== "admin" || !update.isActive);
      if (removesActiveAdmin) {
        const admins = await client.query(
          "SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin' AND is_active = TRUE"
        );
        if (admins.rows[0].total <= 1) {
          await client.query("ROLLBACK");
          return response.status(409).json({
            error: "Debe permanecer al menos un administrador activo."
          });
        }
      }
      const updated = await client.query(
        `UPDATE users SET role = $1, is_active = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING id, name, username, email, role, is_active,
                   email_verified_at, created_at, updated_at`,
        [update.role, update.isActive, request.params.id]
      );
      if (!update.isActive) {
        await client.query("DELETE FROM sessions WHERE user_id = $1", [request.params.id]);
      }
      await client.query("COMMIT");
      response.json({ user: mapUser(updated.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }));

  return router;
}

async function sendInvitationEmail(config, email, inviteUrl, expiresAt) {
  if (!config.resendApiKey || !config.emailFrom) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [email],
      subject: "Invitacion a Seguimiento de Libros",
      html: `<p>Has recibido una invitacion para crear tu cuenta.</p>
        <p><a href="${inviteUrl}">Aceptar invitacion</a></p>
        <p>El enlace es de un solo uso y caduca el ${expiresAt.toISOString()}.</p>`
    })
  });
  if (!response.ok) throw new Error("No se pudo enviar la invitacion por correo.");
  return true;
}

function mapUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role || "user",
    isActive: user.is_active !== false,
    emailVerified: Boolean(user.email_verified_at),
    createdAt: user.created_at,
    updatedAt: user.updated_at
  };
}

function mapInvitation(invitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expires_at,
    acceptedAt: invitation.accepted_at,
    deliveredAt: invitation.delivered_at,
    revokedAt: invitation.revoked_at,
    createdAt: invitation.created_at,
    invitedByUsername: invitation.invited_by_username || null,
    status: invitation.accepted_at
      ? "accepted"
      : invitation.revoked_at
        ? "revoked"
        : new Date(invitation.expires_at) <= new Date()
          ? "expired"
          : "pending"
  };
}
