import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { asyncHandler, requireAuth } from "../middleware.js";
import { supportReportSchema, validate } from "../validation.js";

export function createSupportRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth(pool));
  const reportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Has enviado demasiados reportes. Intenta nuevamente más tarde." }
  });

  router.post("/reports", reportLimiter, asyncHandler(async (request, response) => {
    if (!config.githubSupportToken) {
      return response.status(503).json({
        error: "El canal de soporte todavía no está configurado."
      });
    }

    const [owner, repository, extra] = String(config.githubSupportRepo || "").split("/");
    if (!owner || !repository || extra) {
      return response.status(503).json({
        error: "El repositorio de soporte no está configurado correctamente."
      });
    }

    const report = validate(supportReportSchema, request.body);
    const githubResponse = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/issues`,
      {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${config.githubSupportToken}`,
          "Content-Type": "application/json",
          "User-Agent": "seguimiento-de-libros",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({
          title: `[Soporte: ${report.category}] ${report.title}`,
          body: buildIssueBody(report, request)
        })
      }
    );

    const payload = await githubResponse.json().catch(() => ({}));
    if (!githubResponse.ok) {
      const error = new Error("No se pudo registrar el reporte en este momento.");
      error.status = githubResponse.status === 401 || githubResponse.status === 403
        ? 503
        : 502;
      throw error;
    }

    response.set("Cache-Control", "no-store");
    return response.status(201).json({
      report: {
        number: payload.number,
        url: payload.html_url
      }
    });
  }));

  return router;
}

function buildIssueBody(report, request) {
  const sections = [
    "## Reporte enviado desde la aplicación",
    `**Categoría:** ${report.category}`,
    "",
    "### Descripción",
    report.description
  ];
  if (report.steps) {
    sections.push("", "### Pasos para reproducir", report.steps);
  }
  sections.push(
    "",
    "### Contexto técnico",
    `- Página: ${report.page || "No indicada"}`,
    `- Navegador: ${request.get("user-agent") || "No indicado"}`,
    `- Fecha UTC: ${new Date().toISOString()}`,
    "",
    "> No se incluyeron credenciales ni datos de acceso de la cuenta."
  );
  return sections.join("\n");
}
