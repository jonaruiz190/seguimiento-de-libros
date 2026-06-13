import { randomUUID } from "node:crypto";
import { Router } from "express";
import { asyncHandler, requireAuth } from "../middleware.js";
import { getOpenLibraryBook, searchOpenLibrary } from "../services/catalog.js";
import { catalogImportSchema, catalogSearchSchema, validate } from "../validation.js";

function bookId(book) {
  return `ol-${book.sourceId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 8)}`;
}

export function createCatalogRouter({ pool }) {
  const router = Router();
  router.use(requireAuth(pool));

  router.get("/recommendations", asyncHandler(async (request, response) => {
    const preferencesResult = await pool.query(
      "SELECT category FROM user_preferences WHERE user_id = $1 ORDER BY category LIMIT 3",
      [request.user.id]
    );
    const preferences = preferencesResult.rows.map((row) => row.category);
    const subjects = preferences.length
      ? preferences.map(recommendationSubject)
      : ["fiction", "classics", "fantasy"];
    const searches = await Promise.allSettled(
      subjects.map((subject) => searchOpenLibrary(`subject:${subject}`, 6))
    );
    const recommendations = [];
    const seen = new Set();

    for (const search of searches) {
      if (search.status !== "fulfilled") continue;
      for (const book of search.value) {
        if (seen.has(book.sourceId) || book.pages <= 1) continue;
        seen.add(book.sourceId);
        recommendations.push(book);
        if (recommendations.length === 12) break;
      }
      if (recommendations.length === 12) break;
    }

    if (!recommendations.length) {
      const error = new Error("No se pudieron cargar recomendaciones del catálogo real.");
      error.status = 502;
      throw error;
    }

    const existing = await pool.query(
      `SELECT source_id FROM books
       WHERE catalog_source = 'openlibrary' AND source_id = ANY($1::text[])`,
      [recommendations.map((book) => book.sourceId)]
    );
    const imported = new Set(existing.rows.map((row) => row.source_id));
    response.json({
      books: recommendations.map((book) => ({
        ...book,
        imported: imported.has(book.sourceId)
      }))
    });
  }));

  router.get("/search", asyncHandler(async (request, response) => {
    const input = validate(catalogSearchSchema, request.query);
    const books = await searchOpenLibrary(input.q);
    response.json({ books });
  }));

  router.post("/import", asyncHandler(async (request, response) => {
    const input = validate(catalogImportSchema, request.body);
    const book = await getOpenLibraryBook(input.sourceId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT id FROM books WHERE catalog_source = 'openlibrary' AND source_id = $1",
        [book.sourceId]
      );
      const id = existing.rows[0]?.id || bookId(book);
      const result = await client.query(
        `INSERT INTO books
          (id, title, author, publication_year, pages, rating, cover_url, synopsis,
           isbn_13, publisher, language, catalog_source, source_id, preview_url,
           apple_books_url, kindle_url, metadata_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'openlibrary',
                 $12, $13, $14, $15, NOW())
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, author = EXCLUDED.author,
           publication_year = EXCLUDED.publication_year, pages = EXCLUDED.pages,
           cover_url = EXCLUDED.cover_url, synopsis = EXCLUDED.synopsis,
           isbn_13 = EXCLUDED.isbn_13, publisher = EXCLUDED.publisher,
           language = EXCLUDED.language, preview_url = EXCLUDED.preview_url,
           apple_books_url = EXCLUDED.apple_books_url, kindle_url = EXCLUDED.kindle_url,
           metadata_synced_at = NOW(), updated_at = NOW()
         RETURNING id`,
        [
          id, book.title, book.author, book.year, book.pages, book.rating,
          book.cover, book.synopsis, book.isbn13, book.publisher, book.language,
          book.sourceId, book.previewUrl, book.appleBooksUrl, book.kindleUrl
        ]
      );
      await client.query("DELETE FROM book_categories WHERE book_id = $1", [id]);
      for (const category of book.categories.length ? book.categories : ["General"]) {
        await client.query(
          "INSERT INTO book_categories (book_id, category) VALUES ($1, $2)",
          [id, category]
        );
      }
      await client.query("COMMIT");
      response.status(existing.rowCount ? 200 : 201).json({ id: result.rows[0].id });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }));

  return router;
}

function recommendationSubject(preference) {
  const subjects = {
    "Fantasía": "fantasy",
    "Ciencia ficción": "science_fiction",
    "Clásicos": "classics",
    "Romance": "romance",
    "Historia": "history",
    "Desarrollo personal": "self_help",
    "Realismo mágico": "magical_realism"
  };
  return subjects[preference] || preference.toLowerCase().replaceAll(" ", "_");
}
