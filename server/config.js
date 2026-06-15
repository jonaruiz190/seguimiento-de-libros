import "dotenv/config";

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function parseOrigins(primaryOrigin, value) {
  const origins = String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...new Set([primaryOrigin, ...origins])];
}

export function loadConfig() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const databaseUrl = process.env.DATABASE_URL;
  const appOrigin = process.env.APP_ORIGIN || "http://localhost:3000";

  if (!databaseUrl) {
    throw new Error("DATABASE_URL es obligatoria.");
  }

  return {
    nodeEnv,
    isProduction: nodeEnv === "production",
    port: parsePositiveInteger(process.env.PORT, 3000),
    databaseUrl,
    databaseSsl: parseBoolean(process.env.DATABASE_SSL, nodeEnv === "production"),
    databaseSslRejectUnauthorized: parseBoolean(
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED,
      true
    ),
    appOrigin,
    allowedOrigins: parseOrigins(appOrigin, process.env.APP_ALLOWED_ORIGINS),
    allowRegistration: parseBoolean(process.env.ALLOW_REGISTRATION, nodeEnv !== "production"),
    sessionDays: parsePositiveInteger(process.env.SESSION_DAYS, 7),
    trustProxy: parsePositiveInteger(process.env.TRUST_PROXY, 0),
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || "",
    spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || "",
    spotifyRedirectUri: process.env.SPOTIFY_REDIRECT_URI ||
      "http://127.0.0.1:3000/api/integrations/spotify/callback",
    integrationEncryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY || "",
    translationApiUrl: process.env.TRANSLATION_API_URL || "",
    translationApiKey: process.env.TRANSLATION_API_KEY || "",
    nytBooksApiKey: process.env.NYT_BOOKS_API_KEY || "",
    githubSupportToken: process.env.GITHUB_SUPPORT_TOKEN || "",
    githubSupportRepo: process.env.GITHUB_SUPPORT_REPO ||
      "jonaruiz190/seguimiento-de-libros",
    resendApiKey: process.env.RESEND_API_KEY || "",
    emailFrom: process.env.EMAIL_FROM || ""
  };
}
