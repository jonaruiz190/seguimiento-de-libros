import "dotenv/config";

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL es obligatoria.");
  }

  return {
    nodeEnv,
    isProduction: nodeEnv === "production",
    port: parsePositiveInteger(process.env.PORT, 3000),
    databaseUrl,
    appOrigin: process.env.APP_ORIGIN || "http://localhost:3000",
    sessionDays: parsePositiveInteger(process.env.SESSION_DAYS, 7),
    trustProxy: parsePositiveInteger(process.env.TRUST_PROXY, 0)
  };
}
