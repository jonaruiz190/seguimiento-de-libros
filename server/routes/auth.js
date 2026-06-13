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
import { loginSchema, profileSchema, registerSchema, validate } from "../validation.js";

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

  router.post("/login", loginLimiter, asyncHandler(async (request, response) => {
    const credentials = validate(loginSchema, request.body);
    const result = await pool.query(
      "SELECT id, name, email, avatar_url, password_hash FROM users WHERE email = $1",
      [credentials.email]
    );
    const user = result.rows[0];

    if (!user || !(await verifyPassword(credentials.password, user.password_hash))) {
      return response.status(401).json({ error: "Correo o contraseña incorrectos." });
    }

    await startSession(pool, config, response, user.id);
    return response.json({ user: await getPublicUser(pool, user) });
  }));

  router.post("/register", registerLimiter, asyncHandler(async (request, response) => {
    const registration = validate(registerSchema, request.body);
    const passwordHash = await hashPassword(registration.password);
    const client = await pool.connect();
    let user;

    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, avatar_url`,
        [registration.name, registration.email, passwordHash]
      );
      user = result.rows[0];

      for (const category of [...new Set(registration.preferences)]) {
        await client.query(
          "INSERT INTO user_preferences (user_id, category) VALUES ($1, $2)",
          [user.id, category]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        error.status = 409;
        error.message = "Ya existe una cuenta con ese correo.";
      }
      throw error;
    } finally {
      client.release();
    }

    await startSession(pool, config, response, user.id);
    response.status(201).json({ user: await getPublicUser(pool, user) });
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
           SET name = $1, avatar_url = $2, password_hash = $3, updated_at = NOW()
           WHERE id = $4`,
          [profile.name, profile.avatarUrl, passwordHash, request.user.id]
        );
      } else {
        await client.query(
          "UPDATE users SET name = $1, avatar_url = $2, updated_at = NOW() WHERE id = $3",
          [profile.name, profile.avatarUrl, request.user.id]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const user = await pool.query(
      "SELECT id, name, email, avatar_url FROM users WHERE id = $1",
      [request.user.id]
    );
    response.json({ user: await getPublicUser(pool, user.rows[0]) });
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
  const preferences = await pool.query(
    "SELECT category FROM user_preferences WHERE user_id = $1 ORDER BY category",
    [user.id]
  );
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatar_url || null,
    preferences: preferences.rows.map((row) => row.category)
  };
}
