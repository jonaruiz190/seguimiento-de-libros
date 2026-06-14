import { Router } from "express";
import { asyncHandler, requireAuth } from "../middleware.js";

export function createBooksRouter({ pool }) {
  const router = Router();
  router.use(requireAuth(pool));

  router.get("/", asyncHandler(async (request, response) => {
    const result = await pool.query(
      `SELECT b.id, b.title, b.author, b.publication_year AS year, b.pages,
              b.rating::float, b.cover_url AS cover, b.synopsis,
              b.isbn_13 AS "isbn13", b.publisher, b.language,
              b.catalog_source AS "catalogSource", b.preview_url AS "previewUrl",
              b.progress_unit AS "progressUnit",
              b.progress_total_known AS "progressTotalKnown",
              b.apple_books_url AS "appleBooksUrl", b.kindle_url AS "kindleUrl",
              COALESCE(
                ARRAY_AGG(bc.category ORDER BY bc.category)
                FILTER (WHERE bc.category IS NOT NULL),
                '{}'
              ) AS categories
       FROM books b
       LEFT JOIN book_categories bc ON bc.book_id = b.id
       GROUP BY b.id
       ORDER BY b.rating DESC, b.title`
    );
    response.json({ books: result.rows });
  }));

  return router;
}
