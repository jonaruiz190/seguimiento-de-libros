import { Router } from "express";
import { asyncHandler } from "../middleware.js";

const ALLOWED_IMAGE_HOSTS = new Set(["covers.openlibrary.org"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const imageCache = new Map();

export function createMediaRouter({ pool, fetchImpl = fetch }) {
  const router = Router();

  router.get("/books/:id", asyncHandler(async (request, response) => {
    const cached = imageCache.get(request.params.id);
    if (cached) return sendImage(response, cached);

    const result = await pool.query(
      "SELECT title, cover_url FROM books WHERE id = $1",
      [request.params.id]
    );
    if (result.rowCount !== 1) {
      return response.status(404).type("image/svg+xml").send(fallbackCover("Libro"));
    }

    const book = result.rows[0];
    try {
      const sourceUrl = new URL(book.cover_url);
      if (sourceUrl.protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(sourceUrl.hostname)) {
        throw new Error("Proveedor de imagen no autorizado.");
      }

      const upstream = await fetchImpl(sourceUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "SeguimientoDeLibros/1.0" }
      });
      const contentType = upstream.headers.get("content-type")?.split(";")[0];
      const declaredLength = Number(upstream.headers.get("content-length") || 0);

      if (!upstream.ok
          || !["image/jpeg", "image/png", "image/webp"].includes(contentType)
          || declaredLength > MAX_IMAGE_BYTES) {
        throw new Error("Respuesta de imagen inválida.");
      }

      const body = Buffer.from(await upstream.arrayBuffer());
      if (body.length === 0 || body.length > MAX_IMAGE_BYTES) {
        throw new Error("Tamaño de imagen inválido.");
      }

      const image = { body, contentType };
      if (imageCache.size >= 50) imageCache.delete(imageCache.keys().next().value);
      imageCache.set(request.params.id, image);
      return sendImage(response, image);
    } catch (error) {
      console.warn(`No se pudo cargar la portada ${request.params.id}: ${error.message}`);
      return response
        .status(200)
        .set("Cache-Control", "public, max-age=300")
        .type("image/svg+xml")
        .send(fallbackCover(book.title));
    }
  }));

  return router;
}

function sendImage(response, image) {
  return response
    .status(200)
    .set("Cache-Control", "public, max-age=86400")
    .type(image.contentType)
    .send(image.body);
}

function fallbackCover(title) {
  const safeTitle = escapeXml(String(title).slice(0, 50));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
    <rect width="600" height="900" fill="#1f5c45"/>
    <rect x="35" y="35" width="530" height="830" fill="none" stroke="#d9c888" stroke-width="3"/>
    <text x="300" y="390" fill="#fffdf8" font-family="Georgia,serif" font-size="42"
      text-anchor="middle">Seguimiento</text>
    <text x="300" y="450" fill="#fffdf8" font-family="Georgia,serif" font-size="42"
      text-anchor="middle">de Libros</text>
    <text x="300" y="540" fill="#d9c888" font-family="Arial,sans-serif" font-size="24"
      text-anchor="middle">${safeTitle}</text>
  </svg>`;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
