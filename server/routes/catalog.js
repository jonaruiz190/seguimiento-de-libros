import { randomUUID } from "node:crypto";
import { Router } from "express";
import { asyncHandler, requireAuth } from "../middleware.js";
import { BOOK_CATEGORIES, categorySubject } from "../catalog-categories.js";
import {
  getOpenLibraryBook,
  searchOpenLibrary,
  translateBook
} from "../services/catalog.js";
import {
  catalogImportSchema,
  catalogSearchSchema,
  rankingSchema,
  recommendationSchema,
  validate
} from "../validation.js";

function bookId(book) {
  return `ol-${book.sourceId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 8)}`;
}

export function createCatalogRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth(pool));

  router.get("/categories", (request, response) => {
    response.json({ categories: BOOK_CATEGORIES.map((category) => category.name) });
  });

  router.get("/recommendations", asyncHandler(async (request, response) => {
    const input = validate(recommendationSchema, request.query);
    const preferenceRows = await pool.query(
      "SELECT category FROM user_preferences WHERE user_id = $1 ORDER BY category LIMIT 5",
      [request.user.id]
    );
    const categories = input.category
      ? [input.category]
      : preferenceRows.rows.length
        ? preferenceRows.rows.map((row) => row.category)
        : ["Fantasía", "Clásicos", "Aventura"];
    const searches = await Promise.allSettled(categories.map((category) =>
      searchOpenLibrary(`subject:${categorySubject(category)}`, 25, {
        language: input.language,
        sort: "rating"
      })
    ));
    const recommendations = [];
    const seen = new Set();

    searches.forEach((search, index) => {
      if (search.status !== "fulfilled") return;
      let categoryCount = 0;
      for (const book of search.value) {
        const categoryBookKey = `${categories[index]}:${book.sourceId}`;
        if (seen.has(categoryBookKey) || book.pages <= 1 || categoryCount >= 20) continue;
        seen.add(categoryBookKey);
        categoryCount += 1;
        recommendations.push({ ...book, recommendedCategory: categories[index] });
      }
    });

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
      categories,
      books: recommendations.map((book) => ({
        ...book,
        imported: imported.has(book.sourceId)
      }))
    });
  }));

  router.get("/search", asyncHandler(async (request, response) => {
    const input = validate(catalogSearchSchema, request.query);
    const books = await searchOpenLibrary(input.q, 24, { language: input.language });
    response.json({ books });
  }));

  router.get("/books/:sourceId", asyncHandler(async (request, response) => {
    const sourceId = validate(catalogImportSchema, {
      sourceId: request.params.sourceId
    }).sourceId;
    const language = String(request.query.language || "es");
    const book = await translateBook(
      await getOpenLibraryBook(sourceId),
      language,
      config
    );
    const existing = await pool.query(
      `SELECT id FROM books
       WHERE catalog_source = 'openlibrary' AND source_id = $1`,
      [sourceId]
    );
    response.json({
      book: {
        ...book,
        imported: existing.rowCount > 0,
        localId: existing.rows[0]?.id || null
      }
    });
  }));

  router.get("/ranking", asyncHandler(async (request, response) => {
    const input = validate(rankingSchema, request.query);
    if (request.query.source === "nyt") {
      if (!config.nytBooksApiKey) {
        return response.status(503).json({
          error: "Configura NYT_BOOKS_API_KEY para consultar best sellers oficiales."
        });
      }
      if (input.year === undefined) {
        return response.status(400).json({
          error: "Selecciona un año para consultar best sellers."
        });
      }
      const url = new URL("https://api.nytimes.com/svc/books/v3/lists/full-overview.json");
      url.searchParams.set("published_date", `${input.year}-01-01`);
      url.searchParams.set("api-key", config.nytBooksApiKey);
      const nytResponse = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!nytResponse.ok) {
        return response.status(502).json({
          error: "NYT Books no pudo devolver el ranking para ese año."
        });
      }
      const payload = await nytResponse.json();
      const books = (payload.results?.lists || []).flatMap((list) =>
        (list.books || []).map((book) => ({
          source: "nyt",
          sourceId: book.primary_isbn13 || `${list.list_id}-${book.rank}`,
          title: book.title,
          author: book.author,
          year: input.year,
          pages: 1,
          rating: 0,
          ratingsCount: 0,
          readersCount: 0,
          cover: book.book_image || "/covers/fallback.svg",
          categories: [list.display_name],
          synopsis: book.description || "Sinopsis no disponible.",
          isbn13: book.primary_isbn13 || null,
          buyUrl: book.amazon_product_url || null,
          rank: book.rank
        }))
      );
      return response.json({
        source: "The New York Times Books API",
        rankingType: `best sellers publicados en ${input.year}`,
        officialBestseller: true,
        books: books.slice(0, 100)
      });
    }
    const query = [];
    if (input.author) query.push(`author:"${input.author.replaceAll('"', "")}"`);
    if (input.category) query.push(`subject:${categorySubject(input.category)}`);
    if (input.year !== undefined) query.push(`first_publish_year:${input.year}`);
    if (!query.length) query.push("language:eng");
    const books = await searchOpenLibrary(query.join(" "), 100, {
      language: input.language,
      sort: "rating"
    });
    response.json({
      source: "Open Library",
      rankingType: "popularidad y valoraciones del catálogo",
      officialBestseller: false,
      books: books
        .filter((book) => book.rating >= input.minRating)
        .sort((a, b) =>
          b.readersCount - a.readersCount ||
          b.ratingsCount - a.ratingsCount ||
          b.rating - a.rating
        )
        .slice(0, 100)
        .map((book, index) => ({ ...book, rank: index + 1 }))
    });
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
           rating = EXCLUDED.rating, cover_url = EXCLUDED.cover_url,
           synopsis = EXCLUDED.synopsis, isbn_13 = EXCLUDED.isbn_13,
           publisher = EXCLUDED.publisher, language = EXCLUDED.language,
           preview_url = EXCLUDED.preview_url,
           apple_books_url = EXCLUDED.apple_books_url,
           kindle_url = EXCLUDED.kindle_url,
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
