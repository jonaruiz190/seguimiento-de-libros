import { Router } from "express";
import { asyncHandler, requireAuth } from "../middleware.js";
import { trackingSchema, validate } from "../validation.js";

export function createTrackingRouter({ pool }) {
  const router = Router();
  router.use(requireAuth(pool));

  router.get("/", asyncHandler(async (request, response) => {
    const result = await pool.query(
      `SELECT id, book_id AS "bookId", status, rating, comment, format
       FROM tracking
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [request.user.id]
    );
    response.json({ tracking: result.rows });
  }));

  router.post("/", asyncHandler(async (request, response) => {
    const item = validate(trackingSchema, request.body);
    try {
      const result = await pool.query(
        `INSERT INTO tracking (user_id, book_id, status, rating, comment, format)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, book_id AS "bookId", status, rating, comment, format`,
        [request.user.id, item.bookId, item.status, item.rating, item.comment, item.format]
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
    const item = validate(trackingSchema, request.body);
    const result = await pool.query(
      `UPDATE tracking
       SET status = $1, rating = $2, comment = $3, format = $4, updated_at = NOW()
       WHERE id = $5 AND user_id = $6
       RETURNING id, book_id AS "bookId", status, rating, comment, format`,
      [item.status, item.rating, item.comment, item.format, request.params.id, request.user.id]
    );

    if (result.rowCount === 0) {
      return response.status(404).json({ error: "Seguimiento no encontrado." });
    }
    return response.json({ tracking: result.rows[0] });
  }));

  router.delete("/:id", asyncHandler(async (request, response) => {
    const result = await pool.query(
      "DELETE FROM tracking WHERE id = $1 AND user_id = $2",
      [request.params.id, request.user.id]
    );
    if (result.rowCount === 0) {
      return response.status(404).json({ error: "Seguimiento no encontrado." });
    }
    return response.status(204).end();
  }));

  return router;
}
