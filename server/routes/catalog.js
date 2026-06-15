import { randomUUID } from "node:crypto";
import { Router } from "express";
import { cached } from "../cache.js";
import { asyncHandler, requireAuth } from "../middleware.js";
import { BOOK_CATEGORIES, categorySubject } from "../catalog-categories.js";
import { getAniListBook, searchAniList } from "../services/anilist.js";
import { getOpenLibraryBook, searchOpenLibrary, translateBook } from "../services/catalog.js";
import {
  catalogImportSchema,
  catalogSearchSchema,
  rankingSchema,
  recommendationSchema,
  validate
} from "../validation.js";

const ASIAN_CATEGORIES = new Set(["Manga", "Manhwa", "Manhua", "Webtoon", "Novela ligera"]);
const NYT_HISTORY_START_YEAR = 2011;
const NYT_CACHE_TTL = 24 * 60 * 60_000;

function bookId(book) {
  return `${book.source === "anilist" ? "al" : "ol"}-${book.sourceId
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 8)}`;
}

export function createCatalogRouter({ pool, config }) {
  const router = Router();
  router.use(requireAuth(pool));

  router.get("/categories", (request, response) => {
    response.set("Cache-Control", "private, no-store");
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
    const imported = await importedSourceKeys(pool, recommendations, request.user.id);
    response.set("Cache-Control", "private, no-store");
    response.json({
      categories,
      books: recommendations.map((book) => ({
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
    response.set("Cache-Control", "private, max-age=300");
    response.json({ books });
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
      `SELECT b.id, EXISTS (
         SELECT 1 FROM tracking t
         WHERE t.book_id = b.id AND t.user_id = $3 AND t.archived_at IS NULL
       ) AS imported
       FROM books b WHERE b.catalog_source = $1 AND b.source_id = $2`,
      [input.source, input.sourceId, request.user.id]
    );
    response.set("Cache-Control", "private, no-store");
    response.json({
      book: {
        ...book,
        imported: existing.rows[0]?.imported === true,
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
      const books = input.year === undefined
        ? await getNytHistoricalBooks(config.nytBooksApiKey)
        : await getNytBooksByYear(config.nytBooksApiKey, input.year);
      const filtered = filterAndRankNytBooks(books, input);
      return response.json({
        source: "The New York Times Books API",
        rankingType: input.year === undefined
          ? "histórico anual oficial desde 2011, ordenado por permanencia y mejor posición"
          : `best sellers publicados en ${input.year}`,
        officialBestseller: true,
        historical: input.year === undefined,
        ratingAvailable: false,
        books: filtered.slice(0, 100)
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
           apple_books_url, kindle_url, progress_unit, progress_total_known,
           metadata_synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, $18, NOW())
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, author = EXCLUDED.author,
           publication_year = EXCLUDED.publication_year, pages = EXCLUDED.pages,
           rating = EXCLUDED.rating, cover_url = EXCLUDED.cover_url,
           synopsis = EXCLUDED.synopsis, isbn_13 = EXCLUDED.isbn_13,
           publisher = EXCLUDED.publisher, language = EXCLUDED.language,
           preview_url = EXCLUDED.preview_url,
           apple_books_url = EXCLUDED.apple_books_url,
           kindle_url = EXCLUDED.kindle_url,
           progress_unit = EXCLUDED.progress_unit,
           progress_total_known = EXCLUDED.progress_total_known,
           metadata_synced_at = NOW(), updated_at = NOW()
         RETURNING id`,
        [
          id, book.title, book.author, book.year, Math.max(1, book.pages), book.rating,
          book.cover, book.synopsis, book.isbn13 || null, book.publisher || null,
          book.language, input.source, book.sourceId, book.previewUrl || book.externalUrl || null,
          book.appleBooksUrl || null, book.kindleUrl || null,
          book.progressUnit || "page", book.progressTotalKnown !== false
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

async function fetchNyt(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const error = new Error("NYT Books no pudo devolver el ranking.");
    error.status = 502;
    throw error;
  }
  return response.json();
}

async function getNytBooksByYear(apiKey, year) {
  return cached(`nyt:overview:${year}`, NYT_CACHE_TTL, async () => {
    const url = new URL("https://api.nytimes.com/svc/books/v3/lists/full-overview.json");
    url.searchParams.set("published_date", `${year}-01-01`);
    url.searchParams.set("api-key", apiKey);
    const payload = await fetchNyt(url);
    return dedupeBooks((payload.results?.lists || []).flatMap((list) =>
      (list.books || []).map((book) => normalizeNytBook(book, {
        category: list.display_name,
        year,
        sourceId: `${list.list_id}-${book.rank}`
      }))
    ));
  });
}

async function getNytHistoricalBooks(apiKey) {
  return cached("nyt:annual-history:2011", NYT_CACHE_TTL, async () => {
    const years = Array.from(
      { length: new Date().getFullYear() - NYT_HISTORY_START_YEAR + 1 },
      (_, index) => new Date().getFullYear() - index
    );
    const snapshots = [];
    for (let index = 0; index < years.length; index += 4) {
      const batch = await Promise.allSettled(
        years.slice(index, index + 4).map((year) => getNytBooksByYear(apiKey, year))
      );
      snapshots.push(...batch.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      ));
    }
    if (!snapshots.length) {
      const error = new Error("NYT Books no pudo devolver el ranking histórico.");
      error.status = 502;
      throw error;
    }
    return aggregateNytHistory(snapshots);
  });
}

function aggregateNytHistory(books) {
  const grouped = new Map();
  for (const book of books) {
    const key = duplicateKey(book);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...book, appearances: 1 });
      continue;
    }
    existing.appearances += 1;
    existing.weeksOnList = Math.max(existing.weeksOnList || 0, book.weeksOnList || 0);
    existing.rank = Math.min(existing.rank || 999, book.rank || 999);
    existing.categories = [...new Set([...existing.categories, ...book.categories])];
  }
  return [...grouped.values()].map((book) => ({
    ...book,
    weeksOnList: Math.max(book.weeksOnList || 0, book.appearances)
  }));
}

function normalizeNytBook(book, context) {
  const isbn = book.primary_isbn13 || context.sourceId || null;
  const rank = Number(context.rank ?? book.rank) || 999;
  const weeks = Number(context.weeks ?? book.weeks_on_list) || 0;
  return {
    source: "nyt",
    sourceId: isbn || context.sourceId,
    title: book.title,
    author: book.author,
    year: context.year || null,
    pages: 1,
    rating: 0,
    ratingsCount: 0,
    readersCount: weeks,
    cover: book.book_image || (isbn
      ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`
      : "/covers/fallback.svg"),
    categories: [context.category],
    synopsis: book.description || "Sinopsis no disponible.",
    isbn13: isbn,
    buyUrl: book.amazon_product_url || null,
    rank,
    weeksOnList: weeks
  };
}

export function filterAndRankNytBooks(books, input) {
  const author = normalizeFilterText(input.author);
  const category = normalizeFilterText(input.category);
  return books
    .filter((book) => !author || normalizeFilterText(book.author).includes(author))
    .filter((book) => !category || nytCategoryMatches(book.categories || [], category))
    .sort((a, b) =>
      (b.weeksOnList || 0) - (a.weeksOnList || 0) ||
      (a.rank || 999) - (b.rank || 999) ||
      String(a.title).localeCompare(String(b.title))
    )
    .map((book, index) => ({ ...book, rank: index + 1 }));
}

function normalizeFilterText(value) {
  return String(value || "").normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nytCategoryMatches(categories, requestedCategory) {
  const actual = normalizeFilterText(categories.join(" "));
  if (actual.includes(requestedCategory)) return true;
  const groups = {
    fiction: [
      "accion", "aventura", "ciencia ficcion", "clasicos", "crimen", "distopia",
      "drama", "erotico", "fantasia", "misterio", "novela historica", "realismo magico",
      "romance", "terror", "thriller"
    ],
    nonfiction: [
      "arte", "autobiografia", "biografia", "ciencia", "desarrollo personal",
      "economia", "ensayo", "espiritualidad", "filosofia", "historia", "politica",
      "psicologia", "religion", "salud", "tecnologia", "viajes"
    ],
    children: ["infantil"],
    "young adult": ["juvenil"],
    graphic: ["comics", "manga", "manhua", "manhwa", "novela grafica", "webtoon"],
    business: ["negocios"],
    "advice how to": ["cocina"]
  };
  return Object.entries(groups).some(([nytToken, appCategories]) =>
    appCategories.includes(requestedCategory) && actual.includes(nytToken)
  );
}

async function importedSourceKeys(pool, books, userId) {
  const openLibraryIds = books.filter((book) => book.source === "openlibrary")
    .map((book) => book.sourceId);
  const aniListIds = books.filter((book) => book.source === "anilist")
    .map((book) => book.sourceId);
  const result = await pool.query(
    `SELECT b.catalog_source, b.source_id
     FROM books b JOIN tracking t ON t.book_id = b.id
     WHERE t.user_id = $1 AND t.archived_at IS NULL
       AND (
         (b.catalog_source = 'openlibrary' AND b.source_id = ANY($2::text[]))
         OR (b.catalog_source = 'anilist' AND b.source_id = ANY($3::text[]))
       )`,
    [userId, openLibraryIds, aniListIds]
  );
  return new Set(result.rows.map((row) => `${row.catalog_source}:${row.source_id}`));
}
