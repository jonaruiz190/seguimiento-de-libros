import { Router } from "express";
import { asyncHandler, requireAuth } from "../middleware.js";

export function createDashboardRouter({ pool }) {
  const router = Router();
  router.use(requireAuth(pool));

  router.get("/", asyncHandler(async (request, response) => {
    const userId = request.user.id;
    const [summaryResult, genreResult, authorResult, monthlyResult, booksResult,
      providerResult, formatResult] =
      await Promise.all([
        pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE t.status = 'Leído')::int AS read_books,
             COUNT(*) FILTER (
               WHERE t.status = 'Leyendo' AND t.archived_at IS NULL
             )::int AS reading_books,
             COALESCE(SUM((t.finished_at - t.started_at) + 1) FILTER (
               WHERE t.status = 'Leído'
                 AND t.started_at IS NOT NULL
                 AND t.finished_at IS NOT NULL
             ), 0)::int AS total_days,
             COALESCE(SUM(b.pages) FILTER (WHERE t.status = 'Leído'), 0)::int AS pages_read,
             ROUND(AVG(t.rating) FILTER (
               WHERE t.status = 'Leído' AND t.rating > 0
             ), 1) AS average_rating,
             ROUND(AVG((t.finished_at - t.started_at) + 1) FILTER (
               WHERE t.status = 'Leído'
                 AND t.started_at IS NOT NULL
                 AND t.finished_at IS NOT NULL
             ), 1) AS average_days
           FROM tracking t
           JOIN books b ON b.id = t.book_id
           WHERE t.user_id = $1`,
          [userId]
        ),
        pool.query(
          `SELECT bc.category AS label, COUNT(DISTINCT t.id)::int AS value
           FROM tracking t
           JOIN book_categories bc ON bc.book_id = t.book_id
           WHERE t.user_id = $1 AND t.status = 'Leído'
           GROUP BY bc.category
           ORDER BY value DESC, label
           LIMIT 8`,
          [userId]
        ),
        pool.query(
          `SELECT b.author AS label, COUNT(*)::int AS value
           FROM tracking t
           JOIN books b ON b.id = t.book_id
           WHERE t.user_id = $1 AND t.status = 'Leído'
           GROUP BY b.author
           ORDER BY value DESC, label
           LIMIT 8`,
          [userId]
        ),
        pool.query(
          `SELECT TO_CHAR(DATE_TRUNC('month', t.finished_at), 'YYYY-MM') AS month,
                  COUNT(*)::int AS books,
                  COALESCE(SUM((t.finished_at - t.started_at) + 1) FILTER (
                    WHERE t.started_at IS NOT NULL AND t.finished_at IS NOT NULL
                  ), 0)::int AS days
           FROM tracking t
           WHERE t.user_id = $1
             AND t.status = 'Leído'
             AND t.finished_at >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months'
           GROUP BY DATE_TRUNC('month', t.finished_at)
           ORDER BY DATE_TRUNC('month', t.finished_at)`,
          [userId]
        ),
        pool.query(
          `SELECT t.id, b.title, b.author, b.cover_url AS cover, b.pages,
                  t.rating, t.started_at AS "startedAt",
                  t.finished_at AS "finishedAt",
                  t.format, t.reading_provider AS "readingProvider",
                  CASE
                    WHEN t.started_at IS NOT NULL AND t.finished_at IS NOT NULL
                    THEN (t.finished_at - t.started_at) + 1
                    ELSE NULL
                  END AS "durationDays"
           FROM tracking t
           JOIN books b ON b.id = t.book_id
           WHERE t.user_id = $1 AND t.status = 'Leído'
           ORDER BY t.finished_at DESC NULLS LAST, t.updated_at DESC`,
          [userId]
        ),
        pool.query(
          `SELECT COALESCE(t.reading_provider, 'Sin especificar') AS label,
                  COUNT(*)::int AS value
           FROM tracking t
           WHERE t.user_id = $1 AND t.format = 'Digital'
             AND (t.archived_at IS NULL OR t.status = 'Leído')
           GROUP BY COALESCE(t.reading_provider, 'Sin especificar')
           ORDER BY value DESC, label
           LIMIT 8`,
          [userId]
        ),
        pool.query(
          `SELECT t.format AS label, COUNT(*)::int AS value
           FROM tracking t
           WHERE t.user_id = $1
             AND (t.archived_at IS NULL OR t.status = 'Leído')
           GROUP BY t.format
           ORDER BY value DESC, label`,
          [userId]
        )
      ]);

    const summary = summaryResult.rows[0];
    const genres = genreResult.rows;
    const authors = authorResult.rows;

    response.json({
      summary: {
        readBooks: numberOrZero(summary.read_books),
        readingBooks: numberOrZero(summary.reading_books),
        totalDays: numberOrZero(summary.total_days),
        pagesRead: numberOrZero(summary.pages_read),
        averageRating: nullableNumber(summary.average_rating),
        averageDays: nullableNumber(summary.average_days),
        topGenre: genres[0]?.label || null,
        topAuthor: authors[0]?.label || null
      },
      genres,
      authors,
      providers: providerResult.rows,
      formats: formatResult.rows,
      monthly: fillMonthlySeries(monthlyResult.rows),
      books: booksResult.rows.map((book) => ({
        ...book,
        pages: numberOrZero(book.pages),
        rating: numberOrZero(book.rating),
        durationDays: nullableNumber(book.durationDays)
      }))
    });
  }));

  return router;
}

function fillMonthlySeries(rows) {
  const values = new Map(rows.map((row) => [row.month, row]));
  const formatter = new Intl.DateTimeFormat("es", { month: "short" });
  const now = new Date();
  const series = [];

  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const key = date.toISOString().slice(0, 7);
    const value = values.get(key);
    series.push({
      month: key,
      label: formatter.format(date).replace(".", ""),
      books: numberOrZero(value?.books),
      days: numberOrZero(value?.days)
    });
  }
  return series;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
