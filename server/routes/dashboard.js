import { Router } from "express";
import { asyncHandler, requireAuth } from "../middleware.js";
import { dashboardFilterSchema, validate } from "../validation.js";

export function createDashboardRouter({ pool }) {
  const router = Router();
  router.use(requireAuth(pool));

  router.get("/", asyncHandler(async (request, response) => {
    const filters = validate(dashboardFilterSchema, request.query);
    const values = [
      request.user.id,
      filters.from || null,
      filters.to || null,
      filters.format || null,
      filters.provider || null,
      filters.status || null
    ];
    const where = `
      t.user_id = $1
      AND ($2::date IS NULL OR COALESCE(t.finished_at, t.started_at, t.created_at::date) >= $2)
      AND ($3::date IS NULL OR COALESCE(t.finished_at, t.started_at, t.created_at::date) <= $3)
      AND ($4::text IS NULL OR t.format = $4)
      AND ($5::text IS NULL OR t.reading_provider = $5)
      AND ($6::text IS NULL OR t.status = $6)
      AND (t.archived_at IS NULL OR t.status = 'Leído')
    `;
    const [
      summaryResult,
      genreResult,
      authorResult,
      monthlyResult,
      booksResult,
      providerResult,
      formatResult,
      formatHeatmapResult
    ] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total_books,
           COUNT(*) FILTER (WHERE t.status = 'Leído')::int AS read_books,
           COUNT(*) FILTER (WHERE t.status = 'Leyendo')::int AS reading_books,
           COUNT(*) FILTER (WHERE t.status = 'Próximo a leer')::int AS next_books,
           COUNT(*) FILTER (WHERE t.status = 'En pausa')::int AS paused_books,
           COUNT(*) FILTER (WHERE t.status = 'Abandonado')::int AS dropped_books,
           COALESCE(SUM(
             CASE
               WHEN t.status = 'Leído'
                 AND t.started_at IS NOT NULL AND t.finished_at IS NOT NULL
                 THEN (t.finished_at - t.started_at) + 1
               WHEN t.status = 'Leyendo' AND t.started_at IS NOT NULL
                 THEN (CURRENT_DATE - t.started_at) + 1
               ELSE 0
             END
           ), 0)::int AS total_days,
           COALESCE(SUM(
             CASE WHEN b.progress_total_known
               THEN b.pages
               ELSE COALESCE(t.current_page, 0)
             END
           ) FILTER (
             WHERE b.progress_unit = 'page' AND t.status = 'Leído'
           ), 0)::int
           + COALESCE(SUM(COALESCE(t.current_page, 0)) FILTER (
             WHERE b.progress_unit = 'page' AND t.status <> 'Leído'
           ), 0)::int AS pages_read,
           COALESCE(SUM(
             CASE WHEN b.progress_total_known AND t.status = 'Leído'
               THEN b.pages
               ELSE COALESCE(t.current_page, 0)
             END
           ) FILTER (WHERE b.progress_unit = 'chapter'), 0)::int AS chapters_read,
           ROUND(AVG(t.rating) FILTER (
             WHERE t.rating > 0
           ), 1) AS average_rating,
           ROUND(AVG(
             CASE
               WHEN t.status = 'Leído'
                 AND t.started_at IS NOT NULL AND t.finished_at IS NOT NULL
                 THEN (t.finished_at - t.started_at) + 1
               WHEN t.status = 'Leyendo' AND t.started_at IS NOT NULL
                 THEN (CURRENT_DATE - t.started_at) + 1
               ELSE NULL
             END
           ), 1) AS average_days
         FROM tracking t JOIN books b ON b.id = t.book_id
         WHERE ${where}`,
        values
      ),
      pool.query(
        `SELECT bc.category AS label, COUNT(DISTINCT t.id)::int AS value
         FROM tracking t JOIN book_categories bc ON bc.book_id = t.book_id
         WHERE ${where}
         GROUP BY bc.category ORDER BY value DESC, label LIMIT 8`,
        values
      ),
      pool.query(
        `SELECT b.author AS label, COUNT(*)::int AS value
         FROM tracking t JOIN books b ON b.id = t.book_id
         WHERE ${where}
         GROUP BY b.author ORDER BY value DESC, label LIMIT 8`,
        values
      ),
      pool.query(
        `SELECT TO_CHAR(DATE_TRUNC(
                  'month', COALESCE(t.finished_at, t.started_at, t.created_at)
                ), 'YYYY-MM') AS month,
                COUNT(*)::int AS books,
                COALESCE(SUM(
                  CASE
                    WHEN t.status = 'Leído'
                      AND t.started_at IS NOT NULL AND t.finished_at IS NOT NULL
                      THEN (t.finished_at - t.started_at) + 1
                    WHEN t.status = 'Leyendo' AND t.started_at IS NOT NULL
                      THEN (CURRENT_DATE - t.started_at) + 1
                    ELSE 0
                  END
                ), 0)::int AS days
         FROM tracking t
         WHERE ${where}
           AND COALESCE(t.finished_at, t.started_at, t.created_at) >= DATE_TRUNC(
             'month', COALESCE($3::date, CURRENT_DATE)
           ) - INTERVAL '11 months'
         GROUP BY DATE_TRUNC(
           'month', COALESCE(t.finished_at, t.started_at, t.created_at)
         )
         ORDER BY DATE_TRUNC(
           'month', COALESCE(t.finished_at, t.started_at, t.created_at)
         )`,
        values
      ),
      pool.query(
        `SELECT t.id, b.title, b.author, b.cover_url AS cover, b.pages,
                b.progress_unit AS "progressUnit", t.status,
                t.current_page AS "currentPage",
                t.rating, t.started_at AS "startedAt", t.finished_at AS "finishedAt",
                t.format, t.reading_provider AS "readingProvider",
                CASE
                  WHEN t.status = 'Leído'
                    AND t.started_at IS NOT NULL AND t.finished_at IS NOT NULL
                    THEN (t.finished_at - t.started_at) + 1
                  WHEN t.status = 'Leyendo' AND t.started_at IS NOT NULL
                    THEN (CURRENT_DATE - t.started_at) + 1
                  ELSE NULL
                END AS "durationDays"
         FROM tracking t JOIN books b ON b.id = t.book_id
         WHERE ${where}
         ORDER BY t.updated_at DESC`,
        values
      ),
      pool.query(
        `SELECT COALESCE(t.reading_provider, 'Sin especificar') AS label,
                COUNT(*)::int AS value
         FROM tracking t
         WHERE ${where} AND t.format IN ('Digital', 'Ambos')
         GROUP BY COALESCE(t.reading_provider, 'Sin especificar')
         ORDER BY value DESC, label LIMIT 8`,
        values
      ),
      pool.query(
        `SELECT t.format AS label, COUNT(*)::int AS value
         FROM tracking t
         WHERE ${where}
         GROUP BY t.format ORDER BY value DESC, label`,
        values
      ),
      pool.query(
        `SELECT TO_CHAR(DATE_TRUNC('month',
                  COALESCE(t.finished_at, t.started_at, t.created_at)), 'YYYY-MM') AS month,
                t.format AS label, COUNT(*)::int AS value
         FROM tracking t
         WHERE ${where}
         GROUP BY DATE_TRUNC('month',
                    COALESCE(t.finished_at, t.started_at, t.created_at)), t.format
         ORDER BY month, label`,
        values
      )
    ]);

    const summary = summaryResult.rows[0];
    const genres = genreResult.rows;
    const authors = authorResult.rows;
    response.set("Cache-Control", "no-store");
    response.json({
      filters,
      summary: {
        totalBooks: numberOrZero(summary.total_books),
        readBooks: numberOrZero(summary.read_books),
        readingBooks: numberOrZero(summary.reading_books),
        nextBooks: numberOrZero(summary.next_books),
        pausedBooks: numberOrZero(summary.paused_books),
        droppedBooks: numberOrZero(summary.dropped_books),
        totalDays: numberOrZero(summary.total_days),
        pagesRead: numberOrZero(summary.pages_read),
        chaptersRead: numberOrZero(summary.chapters_read),
        averageRating: nullableNumber(summary.average_rating),
        averageDays: nullableNumber(summary.average_days),
        topGenre: genres[0]?.label || null,
        topAuthor: authors[0]?.label || null
      },
      genres,
      authors,
      providers: providerResult.rows,
      formats: formatResult.rows,
      formatHeatmap: formatHeatmapResult.rows,
      monthly: fillMonthlySeries(monthlyResult.rows, filters),
      books: booksResult.rows.map((book) => ({
        ...book,
        pages: numberOrZero(book.pages),
        currentPage: nullableNumber(book.currentPage),
        rating: numberOrZero(book.rating),
        durationDays: nullableNumber(book.durationDays)
      }))
    });
  }));

  return router;
}

function fillMonthlySeries(rows, filters = {}) {
  const values = new Map(rows.map((row) => [row.month, row]));
  const formatter = new Intl.DateTimeFormat("es", { month: "short" });
  const end = filters.to
    ? new Date(`${filters.to.slice(0, 7)}-01T00:00:00Z`)
    : new Date();
  const requestedStart = filters.from
    ? new Date(`${filters.from.slice(0, 7)}-01T00:00:00Z`)
    : null;
  const defaultStart = new Date(Date.UTC(
    end.getUTCFullYear(), end.getUTCMonth() - 11, 1
  ));
  const start = requestedStart && requestedStart > defaultStart
    ? requestedStart
    : defaultStart;
  const series = [];
  for (
    let date = new Date(start);
    date <= end && series.length < 12;
    date = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
  ) {
    const key = date.toISOString().slice(0, 7);
    const value = values.get(key);
    series.push({
      month: key,
      label: `${formatter.format(date).replace(".", "")} ${String(date.getUTCFullYear()).slice(2)}`,
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
