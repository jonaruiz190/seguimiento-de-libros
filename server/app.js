import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { createAuthRouter } from "./routes/auth.js";
import { createBooksRouter } from "./routes/books.js";
import { createTrackingRouter } from "./routes/tracking.js";
import { createDashboardRouter } from "./routes/dashboard.js";
import { createCatalogRouter } from "./routes/catalog.js";
import { createIntegrationsRouter } from "./routes/integrations.js";
import { createSupportRouter } from "./routes/support.js";
import { createAdminRouter } from "./routes/admin.js";
import {
  asyncHandler,
  errorHandler,
  notFound,
  requireTrustedOrigin
} from "./middleware.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(currentDirectory, "../public");

export function createApp({ pool, config }) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: [
          "'self'",
          "data:",
          "https:",
          "https://covers.openlibrary.org"
        ],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", "https://open.spotify.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    referrerPolicy: { policy: "no-referrer" }
  }));
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", requireTrustedOrigin(config));

  app.get("/api/health", async (request, response, next) => {
    try {
      await pool.query("SELECT 1");
      response.json({ status: "ok" });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/runtime", asyncHandler(async (request, response) => {
    const users = await pool.query("SELECT COUNT(*)::int AS total FROM users");
    const bootstrapRegistration = Number(users.rows[0]?.total || 0) === 0;
    response.set("Cache-Control", "no-store");
    response.json({
      demoMode: !config.isProduction,
      registrationEnabled: config.allowRegistration !== false || bootstrapRegistration,
      registrationMode: bootstrapRegistration ? "bootstrap" : "invitation"
    });
  }));
  app.use("/api/auth", createAuthRouter({ pool, config }));
  app.use("/api/books", createBooksRouter({ pool, config }));
  app.use("/api/tracking", createTrackingRouter({ pool, config }));
  app.use("/api/dashboard", createDashboardRouter({ pool, config }));
  app.use("/api/catalog", createCatalogRouter({ pool, config }));
  app.use("/api/integrations", createIntegrationsRouter({ pool, config }));
  app.use("/api/support", createSupportRouter({ pool, config }));
  app.use("/api/admin", createAdminRouter({ pool, config }));

  app.use(express.static(publicDirectory, {
    extensions: ["html"],
    etag: true,
    maxAge: config.isProduction ? "1d" : 0,
    setHeaders(response, filePath) {
      if (config.isProduction && /\.(?:jpg|jpeg|png|webp|svg|woff2?)$/i.test(filePath)) {
        response.setHeader("Cache-Control", "public, max-age=604800, immutable");
      }
    }
  }));
  app.get("/{*path}", (request, response, next) => {
    if (request.path.startsWith("/api/")) return next();
    return response.sendFile(path.join(publicDirectory, "index.html"));
  });
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
