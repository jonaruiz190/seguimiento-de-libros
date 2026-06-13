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
import {
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
  app.use("/api/auth", createAuthRouter({ pool, config }));
  app.use("/api/books", createBooksRouter({ pool, config }));
  app.use("/api/tracking", createTrackingRouter({ pool, config }));
  app.use("/api/dashboard", createDashboardRouter({ pool, config }));
  app.use("/api/catalog", createCatalogRouter({ pool, config }));
  app.use("/api/integrations", createIntegrationsRouter({ pool, config }));

  app.use(express.static(publicDirectory, {
    extensions: ["html"],
    maxAge: config.isProduction ? "1h" : 0
  }));
  app.get("/{*path}", (request, response, next) => {
    if (request.path.startsWith("/api/")) return next();
    return response.sendFile(path.join(publicDirectory, "index.html"));
  });
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
