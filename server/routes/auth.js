import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { asyncHandler, requireAuth } from "../middleware.js";
import {
  createSessionToken,
  hashSessionToken,
  hashPassword,
  sessionCookieOptions,
  verifyPassword
} from "../security.js";
import {
  deleteProfileSchema,
  forgotPasswordSchema,
  loginSchema,
  profileSchema,
  registerSchema,
  resetPasswordSchema,
  validate
} from "../validation.js";

export function createAuthRouter({ pool, config }) {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Demasiados intentos. Intenta nuevamente en 15 minutos." }
  });
  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Demasiados registros desde esta conexión. Intenta más tarde." }
  });
  const recoveryLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Demasiadas solicitudes. Intenta nuevamente más tarde." }
  });

  router.post("/login", loginLimiter, asyncHandler(async (request, response) => {
    const credentials = validate(loginSchema, request.body);
    const result = await pool.query(
      `SELECT id, name, username, email, avatar_url, language, spotify_playlist_url,
              password_hash, role, is_active, email_verified_at
       FROM users WHERE email = $1`,
      [credentials.email]
    );
    const user = result.rows[0];

    if (!user || !user.is_active ||
        !(await verifyPassword(credentials.password, user.password_hash))) {
      return response.status(401).json({ error: "Correo o contraseña incorrectos." });
    }

    await startSession(pool, config, response, user.id);
    return response.json({ user: await getPublicUser(pool, user) });
  }));

  router.get("/invitation", asyncHandler(async (request, response) => {
    const token = String(request.query.token || "");
    if (token.length < 32 || token.length > 200) {
      return response.status(400).json({ error: "La invitacion no es valida." });
    }
    const invitation = await pool.query(
      `SELECT email, role, expires_at
       FROM user_invitations
       WHERE token_hash = $1
         AND accepted_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > NOW()`,
      [hashSessionToken(token)]
    );
    if (!invitation.rowCount) {
      return response.status(404).json({ error: "La invitacion expiro o ya fue utilizada." });
    }
    response.set("Cache-Control", "no-store");
    response.json({
      invitation: {
        email: invitation.rows[0].email,
        role: invitation.rows[0].role,
        expiresAt: invitation.rows[0].expires_at
      }
    });
  }));

  router.post("/register", registerLimiter, asyncHandler(async (request, response) => {
    const registration = validate(registerSchema, request.body);
    if (config.allowRegistration === false && !registration.invitationToken) {
      const users = await pool.query("SELECT COUNT(*)::int AS total FROM users");
      if (Number(users.rows[0]?.total || 0) > 0) {
        return response.status(403).json({
          error: "Necesitas una invitación para crear la cuenta."
        });
      }
    }
    const passwordHash = await hashPassword(registration.password);
    const client = await pool.connect();
    let user;

    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(734921)");
      const userCount = await client.query("SELECT COUNT(*)::int AS total FROM users");
      const isBootstrap = Number(userCount.rows[0]?.total || 0) === 0;
      let role = "user";
      let invitationId = null;
      let emailVerifiedAt = new Date();

      if (isBootstrap) {
        role = "admin";
      } else if (registration.invitationToken) {
        const invitation = await client.query(
          `SELECT id, email, role, delivered_at
           FROM user_invitations
           WHERE token_hash = $1
             AND accepted_at IS NULL
             AND revoked_at IS NULL
             AND expires_at > NOW()
           FOR UPDATE`,
          [hashSessionToken(registration.invitationToken)]
        );
        if (!invitation.rowCount) {
          const error = new Error("La invitación expiró o ya fue utilizada.");
          error.status = 403;
          throw error;
        }
        if (invitation.rows[0].email.toLowerCase() !== registration.email) {
          const error = new Error("La invitación pertenece a otro correo.");
          error.status = 403;
          throw error;
        }
        role = invitation.rows[0].role;
        invitationId = invitation.rows[0].id;
        emailVerifiedAt = invitation.rows[0].delivered_at ? new Date() : null;
      } else if (config.allowRegistration === false) {
        const error = new Error("Necesitas una invitación para crear la cuenta.");
        error.status = 403;
        throw error;
      }

      const result = await client.query(
        `INSERT INTO users
           (name, username, email, password_hash, role, email_verified_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, username, email, avatar_url, role,
                   is_active, email_verified_at`,
        [
          registration.name,
          registration.username,
          registration.email,
          passwordHash,
          role,
          emailVerifiedAt
        ]
      );
      user = result.rows[0];

      for (const category of [...new Set(registration.preferences)]) {
        await client.query(
          "INSERT INTO user_preferences (user_id, category) VALUES ($1, $2)",
          [user.id, category]
        );
      }
      if (invitationId) {
        await client.query(
          "UPDATE user_invitations SET accepted_at = NOW() WHERE id = $1",
          [invitationId]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        error.status = 409;
        error.message = error.constraint === "users_username_lower_unique"
          ? "Ese nombre de usuario ya está en uso."
          : "Ya existe una cuenta con ese correo.";
      }
      throw error;
    } finally {
      client.release();
    }

    await startSession(pool, config, response, user.id);
    response.status(201).json({ user: await getPublicUser(pool, user) });
  }));

  router.post("/forgot-password", recoveryLimiter, asyncHandler(async (request, response) => {
    const input = validate(forgotPasswordSchema, request.body);
    const user = await pool.query("SELECT id, email FROM users WHERE email = $1", [input.email]);
    let developmentResetUrl = null;
    if (user.rowCount) {
      const token = createSessionToken();
      const tokenHash = hashSessionToken(token);
      await pool.query(
        `UPDATE password_reset_tokens SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL`,
        [user.rows[0].id]
      );
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
        [user.rows[0].id, tokenHash]
      );
      const resetUrl = `${config.appOrigin}/?reset=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail(config, user.rows[0].email, resetUrl);
      if (!config.isProduction && !config.resendApiKey) developmentResetUrl = resetUrl;
    }
    response.json({
      message: "Si la cuenta existe, recibirás instrucciones para restablecer la contraseña.",
      ...(developmentResetUrl ? { developmentResetUrl } : {})
    });
  }));

  router.post("/reset-password", recoveryLimiter, asyncHandler(async (request, response) => {
    const input = validate(resetPasswordSchema, request.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const reset = await client.query(
        `SELECT id, user_id FROM password_reset_tokens
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
         FOR UPDATE`,
        [hashSessionToken(input.token)]
      );
      if (reset.rowCount !== 1) {
        const error = new Error("El enlace es inválido o ha expirado.");
        error.status = 400;
        throw error;
      }
      const passwordHash = await hashPassword(input.password);
      await client.query(
        "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
        [passwordHash, reset.rows[0].user_id]
      );
      await client.query(
        "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1",
        [reset.rows[0].id]
      );
      await client.query("DELETE FROM sessions WHERE user_id = $1", [reset.rows[0].user_id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    response.status(204).end();
  }));

  router.get("/me", requireAuth(pool), asyncHandler(async (request, response) => {
    response.json({ user: await getPublicUser(pool, request.user) });
  }));

  router.put("/profile", requireAuth(pool), asyncHandler(async (request, response) => {
    const profile = validate(profileSchema, request.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (profile.newPassword) {
        const current = await client.query(
          "SELECT password_hash FROM users WHERE id = $1",
          [request.user.id]
        );
        if (!await verifyPassword(profile.currentPassword, current.rows[0].password_hash)) {
          const error = new Error("La contraseña actual no es correcta.");
          error.status = 401;
          throw error;
        }
        const passwordHash = await hashPassword(profile.newPassword);
        await client.query(
          `UPDATE users
           SET name = $1, username = $2, avatar_url = $3, language = $4,
               spotify_playlist_url = $5, password_hash = $6, updated_at = NOW()
           WHERE id = $7`,
          [
            profile.name, profile.username, profile.avatarUrl, profile.language,
            profile.spotifyPlaylistUrl, passwordHash, request.user.id
          ]
        );
      } else {
        await client.query(
          `UPDATE users
           SET name = $1, username = $2, avatar_url = $3, language = $4,
               spotify_playlist_url = $5, updated_at = NOW()
           WHERE id = $6`,
          [
            profile.name, profile.username, profile.avatarUrl, profile.language,
            profile.spotifyPlaylistUrl, request.user.id
          ]
        );
      }
      await client.query("DELETE FROM user_preferences WHERE user_id = $1", [request.user.id]);
      for (const category of [...new Set(profile.preferences)]) {
        await client.query(
          "INSERT INTO user_preferences (user_id, category) VALUES ($1, $2)",
          [request.user.id, category]
        );
      }
      await client.query("DELETE FROM user_favorite_authors WHERE user_id = $1", [request.user.id]);
      for (const author of [...new Set(profile.favoriteAuthors)]) {
        await client.query(
          "INSERT INTO user_favorite_authors (user_id, author) VALUES ($1, $2)",
          [request.user.id, author]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505" && error.constraint === "users_username_lower_unique") {
        error.status = 409;
        error.message = "Ese nombre de usuario ya está en uso.";
      }
      throw error;
    } finally {
      client.release();
    }

    const user = await pool.query(
      `SELECT id, name, username, email, avatar_url, language, spotify_playlist_url,
              role, is_active, email_verified_at
       FROM users WHERE id = $1`,
      [request.user.id]
    );
    response.json({ user: await getPublicUser(pool, user.rows[0]) });
  }));

  router.delete("/profile", requireAuth(pool), asyncHandler(async (request, response) => {
    const input = validate(deleteProfileSchema, request.body);
    const current = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [request.user.id]
    );
    if (!current.rowCount || !(await verifyPassword(input.password, current.rows[0].password_hash))) {
      return response.status(401).json({ error: "La contraseña no es correcta." });
    }
    if (request.user.role === "admin") {
      const admins = await pool.query(
        "SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin' AND is_active = TRUE"
      );
      if (admins.rows[0].total <= 1) {
        return response.status(409).json({
          error: "No puedes eliminar la unica cuenta administradora activa."
        });
      }
    }
    await pool.query("DELETE FROM users WHERE id = $1", [request.user.id]);
    response.clearCookie("sid", {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      path: "/"
    });
    response.status(204).end();
  }));

  router.post("/logout", requireAuth(pool), asyncHandler(async (request, response) => {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [request.sessionTokenHash]);
    response.clearCookie("sid", {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      path: "/"
    });
    response.status(204).end();
  }));

  return router;
}

async function sendPasswordResetEmail(config, email, resetUrl) {
  if (!config.resendApiKey || !config.emailFrom) {
    if (!config.isProduction) console.info(`Enlace de recuperación para ${email}: ${resetUrl}`);
    return;
  }
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
      subject: "Restablece tu contraseña",
      html: `<p>Solicitaste restablecer tu contraseña.</p>
        <p><a href="${resetUrl}">Crear una contraseña nueva</a></p>
        <p>El enlace caduca en 30 minutos y solo puede usarse una vez.</p>`
    })
  });
  if (!response.ok) throw new Error("No se pudo enviar el correo de recuperación.");
}

async function startSession(pool, config, response, userId) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000);
  await pool.query("DELETE FROM sessions WHERE expires_at <= NOW()");
  await pool.query(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, hashSessionToken(token), expiresAt]
  );
  response.cookie("sid", token, sessionCookieOptions(config));
}

async function getPublicUser(pool, user) {
  const [preferences, authors] = await Promise.all([
    pool.query(
      "SELECT category FROM user_preferences WHERE user_id = $1 ORDER BY category",
      [user.id]
    ),
    pool.query(
      "SELECT author FROM user_favorite_authors WHERE user_id = $1 ORDER BY author",
      [user.id]
    )
  ]);
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role || "user",
    isAdmin: user.role === "admin",
    emailVerified: Boolean(user.email_verified_at),
    avatarUrl: user.avatar_url || null,
    language: user.language || "es",
    spotifyPlaylistUrl: user.spotify_playlist_url || null,
    preferences: preferences.rows.map((row) => row.category),
    favoriteAuthors: authors.rows.map((row) => row.author)
  };
}
