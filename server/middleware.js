import { hashSessionToken, parseCookies } from "./security.js";

export function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export function requireTrustedOrigin(config) {
  return (request, response, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();

    const cookies = parseCookies(request.headers.cookie);
    if (!cookies.sid) return next();

    const origin = request.get("origin");
    if (origin !== config.appOrigin) {
      return response.status(403).json({ error: "Origen no autorizado." });
    }
    return next();
  };
}

export function requireAuth(pool) {
  return asyncHandler(async (request, response, next) => {
    const token = parseCookies(request.headers.cookie).sid;
    if (!token) return response.status(401).json({ error: "Debes iniciar sesión." });

    const tokenHash = hashSessionToken(token);
    const result = await pool.query(
      `SELECT u.id, u.name, u.email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [tokenHash]
    );

    if (result.rowCount !== 1) {
      response.clearCookie("sid", { path: "/" });
      return response.status(401).json({ error: "La sesión expiró." });
    }

    request.user = result.rows[0];
    request.sessionTokenHash = tokenHash;
    return next();
  });
}

export function notFound(request, response) {
  response.status(404).json({ error: "Recurso no encontrado." });
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);

  const invalidJson = error instanceof SyntaxError && error.status === 400 && "body" in error;
  const status = invalidJson ? 400 : (Number.isInteger(error.status) ? error.status : 500);
  if (status >= 500) console.error(error);

  return response.status(status).json({
    error: invalidJson
      ? "El cuerpo JSON no es válido."
      : (status >= 500 ? "Ocurrió un error interno." : error.message),
    ...(error.details ? { details: error.details } : {})
  });
}
