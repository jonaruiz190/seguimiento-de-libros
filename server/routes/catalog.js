import { randomUUID } from "node:crypto";
import { Router } from "express";
import { asyncHandler, requireAuth } from "../middleware.js";
import { BOOK_CATEGORIES, categorySubject } from "../catalog-categories.js";
import { getAniListBook, searchAniList } from "../services/anilist.js";
import {
  getOpenLibraryBook,
  searchOpenLibrary,
  translateBook,
  translateBookTitles
} from "../services/catalog.js";
import {
  catalogImportSchema,
  catalogSearchSchema,
  rankingSchema,
  recommendationSchema,
  validate
} from "../validation.js";

const ASIAN_CATEGORIES = new Set(["Manga", "Manhwa", "Manhua", "Webtoon", "Novela ligera"]);

function bookId(book) {
  return `${book.source === "anilist" ? "al" : "ol"}-${book.sourceId
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 8)}`;
}

export function createCatalogRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth(pool));

  router.get("/categories", (request, response) => {
    response.set("Cache-Control", "private, max-age=3600");
    response.json({
      categories: BOOK_CATEGORIES.map((category) => category.name),
      capabilities: {
        nytBestsellers: Boolean(config.nytBooksApiKey),
        translation: Boolean(config.translationApiUrl),
        anilist: true
      }
    });
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
      ASIAN_CATEGORIES.has(category)
        ? searchAniList({ category, language: input.language, limit: 30 })
        : searchOpenLibrary(`subject:${categorySubject(category)}`, 35, {
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
        const key = duplicateKey(book);
        if (seen.has(key) || book.pages <= 0 || categoryCount >= 20) continue;
        seen.add(key);
        categoryCount += 1;
        recommendations.push({ ...book, recommendedCategory: categories[index] });
      }
    });
    if (!recommendations.length) {
      const error = new Error("No se pudieron cargar recomendaciones del catálogo real.");
      error.status = 502;
      throw error;
    }
    const localized = input.category
      ? await localizeBooks(
        recommendations,
        input.language || request.user.language || "es",
        config
      )
      : recommendations;
    const imported = await importedSourceKeys(pool, localized);
    response.set("Cache-Control", "private, max-age=300");
    response.json({
      categories,
      books: localized.map((book) => ({
        ...book,
        imported: imported.has(`${book.source}:${book.sourceId}`)
      }))
    });
  }));

  router.get("/search", asyncHandler(async (request, response) => {
    const input = validate(catalogSearchSchema, request.query);
    const tasks = [];
    if (input.source !== "anilist") {
      tasks.push(searchOpenLibrary(input.q, 24, { language: input.language }));
    }
    if (input.source !== "books") {
      tasks.push(searchAniList({ query: input.q, language: input.language, limit: 24 }));
    }
    const settled = await Promise.allSettled(tasks);
    const books = dedupeBooks(settled.flatMap((result) =>
      result.status === "fulfilled" ? result.value : []
    ));
    const firstPage = await localizeBooks(books.slice(0, 24), input.language || "es", config);
    const localized = [...firstPage, ...books.slice(24)];
    response.set("Cache-Control", "private, max-age=300");
    response.json({ books: localized });
  }));

  router.get("/books/:sourceId", asyncHandler(async (request, response) => {
    const input = validate(catalogImportSchema, {
      sourceId: request.params.sourceId,
      source: request.query.source || "openlibrary"
    });
    const language = String(request.query.language || "es");
    const rawBook = input.source === "anilist"
      ? await getAniListBook(input.sourceId, language)
      : await getOpenLibraryBook(input.sourceId);
    const book = await translateBook(rawBook, language, config);
    const existing = await pool.query(
      "SELECT id FROM books WHERE catalog_source = $1 AND source_id = $2",
      [input.source, input.sourceId]
    );
    response.set("Cache-Control", "private, max-age=600");
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
    if (input.source === "nyt") {
      if (!config.nytBooksApiKey) {
        return response.status(503).json({
          error: "Los best sellers oficiales requieren configurar una API key de NYT Books."
        });
      }
      if (input.year === undefined) {
        return response.status(400).json({ error: "Selecciona un año para consultar best sellers." });
      }
      const url = new URL("https://api.nytimes.com/svc/books/v3/lists/full-overview.json");
      url.searchParams.set("published_date", `${input.year}-01-01`);
      url.searchParams.set("api-key", config.nytBooksApiKey);
      const nytResponse = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!nytResponse.ok) {
        return response.status(502).json({ error: "NYT Books no pudo devolver el ranking." });
      }
      const payload = await nytResponse.json();
      const books = dedupeBooks((payload.results?.lists || []).flatMap((list) =>
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
      ));
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
    const books = dedupeBooks(await searchOpenLibrary(query.join(" "), 150, {
      language: input.language,
      sort: "rating"
    }));
    response.set("Cache-Control", "private, max-age=600");
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
    const book = input.source === "anilist"
      ? await getAniListBook(input.sourceId, request.user.language || "es")
      : await getOpenLibraryBook(input.sourceId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT id FROM books WHERE catalog_source = $1 AND source_id = $2",
        [input.source, input.sourceId]
      );
      const id = existing.rows[0]?.id || bookId(book);
      const result = await client.query(
        `INSERT INTO books
          (id, title, author, publication_year, pages, rating, cover_url, synopsis,
           isbn_13, publisher, language, catalog_source, source_id, preview_url,
           apple_books_url, kindle_url, metadata_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, NOW())
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
          id, book.title, book.author, book.year, Math.max(1, book.pages), book.rating,
          book.cover, book.synopsis, book.isbn13 || null, book.publisher || null,
          book.language, input.source, book.sourceId, book.previewUrl || book.externalUrl || null,
          book.appleBooksUrl || null, book.kindleUrl || null
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

function duplicateKey(book) {
  const title = String(book.title || "").normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const author = String(book.author || "").normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${title}:${author}`;
}

function dedupeBooks(books) {
  const seen = new Set();
  return books.filter((book) => {
    const key = duplicateKey(book);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function importedSourceKeys(pool, books) {
  const openLibraryIds = books.filter((book) => book.source === "openlibrary")
    .map((book) => book.sourceId);
  const aniListIds = books.filter((book) => book.source === "anilist")
    .map((book) => book.sourceId);
  const result = await pool.query(
    `SELECT catalog_source, source_id FROM books
     WHERE (catalog_source = 'openlibrary' AND source_id = ANY($1::text[]))
        OR (catalog_source = 'anilist' AND source_id = ANY($2::text[]))`,
    [openLibraryIds, aniListIds]
  );
  return new Set(result.rows.map((row) => `${row.catalog_source}:${row.source_id}`));
}

async function localizeBooks(books, language, config) {
  if (!config.translationApiUrl) return books;
  return translateBookTitles(books, language, config);
}
