import { Router } from "express";
import { asyncHandler, requireAuth } from "../middleware.js";
import { trackingSchema, validate } from "../validation.js";

export function createTrackingRouter({ pool }) {
  const router = Router();
  router.use(requireAuth(pool));

  router.get("/", asyncHandler(async (request, response) => {
    const result = await pool.query(
      `SELECT id, book_id AS "bookId", status, rating, comment, format,
              started_at AS "startedAt", finished_at AS "finishedAt",
              reading_provider AS "readingProvider",
              current_page AS "currentPage", updated_at AS "updatedAt"
       FROM tracking
       WHERE user_id = $1 AND archived_at IS NULL
       ORDER BY updated_at DESC`,
      [request.user.id]
    );
    response.set("Cache-Control", "no-store");
    response.json({ tracking: result.rows });
  }));

  router.post("/", asyncHandler(async (request, response) => {
    const item = await normalizeTrackingItem(pool, validate(trackingSchema, request.body));
    try {
      const result = await pool.query(
        `INSERT INTO tracking
          (user_id, book_id, status, rating, comment, format,
           started_at, finished_at, reading_minutes, reading_provider, current_page)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10)
         ON CONFLICT (user_id, book_id) DO UPDATE SET
           status = EXCLUDED.status, rating = EXCLUDED.rating,
           comment = EXCLUDED.comment, format = EXCLUDED.format,
           started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at,
           reading_provider = EXCLUDED.reading_provider,
           current_page = EXCLUDED.current_page, archived_at = NULL,
           updated_at = NOW()
         RETURNING id, book_id AS "bookId", status, rating, comment, format,
                   started_at AS "startedAt", finished_at AS "finishedAt",
                   reading_provider AS "readingProvider",
                   current_page AS "currentPage", updated_at AS "updatedAt"`,
        [
          request.user.id,
          item.bookId,
          item.status,
          item.rating,
          item.comment,
          item.format,
          item.startedAt,
          item.finishedAt,
          item.readingProvider,
          item.currentPage
        ]
      );
      response.status(201).json({ tracking: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") {
        error.status = 409;
        error.message = "Este libro ya está en tu seguimiento.";
      } else if (error.code === "23503") {
        error.status = 400;
        error.message = "El libro seleccionado no existe.";
      }
      throw error;
    }
  }));

  router.put("/:id", asyncHandler(async (request, response) => {
    const item = await normalizeTrackingItem(pool, validate(trackingSchema, request.body));
    const result = await pool.query(
      `UPDATE tracking
       SET status = $1, rating = $2, comment = $3, format = $4,
           started_at = $5, finished_at = $6,
           reading_provider = $7, current_page = $8,
           updated_at = NOW()
       WHERE id = $9 AND user_id = $10
       RETURNING id, book_id AS "bookId", status, rating, comment, format,
                 started_at AS "startedAt", finished_at AS "finishedAt",
                 reading_provider AS "readingProvider",
                 current_page AS "currentPage", updated_at AS "updatedAt"`,
      [
        item.status,
        item.rating,
        item.comment,
        item.format,
        item.startedAt,
        item.finishedAt,
        item.readingProvider,
        item.currentPage,
        request.params.id,
        request.user.id
      ]
    );

    if (result.rowCount === 0) {
      return response.status(404).json({ error: "Seguimiento no encontrado." });
    }
    return response.json({ tracking: result.rows[0] });
  }));

  router.delete("/:id", asyncHandler(async (request, response) => {
    const result = await pool.query(
      `UPDATE tracking
       SET archived_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
      [request.params.id, request.user.id]
    );
    if (result.rowCount === 0) {
      return response.status(404).json({ error: "Seguimiento no encontrado." });
    }
    return response.status(204).end();
  }));

  return router;
}

export async function normalizeTrackingItem(pool, item) {
  const result = await pool.query(
    `SELECT pages, progress_total_known AS "progressTotalKnown"
     FROM books WHERE id = $1`,
    [item.bookId]
  );
  if (!result.rowCount) return item;
  const pages = Math.max(1, Number(result.rows[0].pages) || 1);
  const totalKnown = result.rows[0].progressTotalKnown !== false;
  return {
    ...item,
    readingProvider: item.format === "Físico" ? null : item.readingProvider,
    currentPage: item.status === "Leído" && totalKnown
      ? pages
      : item.currentPage === null
        ? null
        : totalKnown
          ? Math.min(item.currentPage, pages)
          : item.currentPage
  };
}
