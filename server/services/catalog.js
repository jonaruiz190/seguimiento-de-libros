import { cached } from "../cache.js";

const OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json";
const OPEN_LIBRARY_BOOK = "https://openlibrary.org";
const APPLE_SEARCH = "https://itunes.apple.com/search";
const GOOGLE_BOOKS_SEARCH = "https://www.googleapis.com/books/v1/volumes";

function first(values, fallback = null) {
  return Array.isArray(values) && values.length ? values[0] : fallback;
}

function isbn13(values = []) {
  return values.find((value) => /^\d{13}$/.test(value)) || null;
}

function cleanCategories(values = []) {
  return [...new Set(values
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) =>
      value &&
      value.length <= 60 &&
      !value.includes("=") &&
      !value.includes(":")
    ))]
    .slice(0, 6);
}

function text(value, fallback, maxLength) {
  const normalized = String(value || fallback).trim();
  return normalized.slice(0, maxLength);
}

function coverUrl(coverId) {
  return coverId
    ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
    : "/covers/fallback.svg";
}

function cleanDescription(value) {
  if (!value) return null;
  return String(value)
    .replace(/^\[[^\]]+\]\[\d+\]:\s*/i, "")
    .replace(/\[\d+\]:\s+\S+/g, "")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s{3,}/g, "\n\n")
    .trim()
    .slice(0, 5000);
}

export function normalizeOpenLibraryBook(document) {
  const identifier = String(document.key || "").replace(/^\/works\//, "");
  const isbn = isbn13(document.isbn);
  const year = Number(document.first_publish_year);
  const pages = Number(document.number_of_pages_median);
  return {
    source: "openlibrary",
    sourceId: identifier,
    title: text(document.title, "Libro sin título", 250),
    author: text(first(document.author_name), "Autor desconocido", 180),
    year: year >= 0 && year <= 3000 ? year : new Date().getFullYear(),
    pages: pages > 0 && pages <= 100000 ? pages : 1,
    progressUnit: "page",
    progressTotalKnown: pages > 0 && pages <= 100000,
    rating: Math.min(5, Math.max(0, Number(document.ratings_average) || 0)),
    ratingsCount: Math.max(0, Number(document.ratings_count) || 0),
    readersCount: Math.max(
      0,
      Number(document.already_read_count) || Number(document.want_to_read_count) || 0
    ),
    cover: coverUrl(document.cover_i),
    categories: cleanCategories(document.subject),
    synopsis: "Sinopsis pendiente de actualización desde el catálogo.",
    isbn13: isbn,
    publisher: first(document.publisher)
      ? text(first(document.publisher), "", 180)
      : null,
    language: first(document.language)
      ? text(first(document.language), "", 20)
      : null,
    previewUrl: isbn ? `https://books.google.com/books?vid=ISBN${isbn}` : null,
    kindleUrl: `https://www.amazon.com/s?k=${encodeURIComponent(isbn || document.title)}&i=stripbooks`
  };
}

async function fetchJson(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10_000),
        headers: {
          "User-Agent": "SeguimientoDeLibros/1.0",
          ...options.headers
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const error = new Error("El catálogo externo no está disponible temporalmente.");
  error.status = 502;
  error.cause = lastError;
  throw error;
}

export async function searchOpenLibrary(query, limit = 12, options = {}) {
  const url = new URL(OPEN_LIBRARY_SEARCH);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  if (options.language) url.searchParams.set("lang", options.language);
  if (options.sort) url.searchParams.set("sort", options.sort);
  url.searchParams.set(
    "fields",
    "key,title,author_name,first_publish_year,number_of_pages_median,isbn,subject,cover_i,language,publisher,ratings_average,ratings_count,want_to_read_count,already_read_count"
  );
  const payload = await cached(`openlibrary:${url}`, 30 * 60_000, () => fetchJson(url));
  return (payload.docs || [])
    .map(normalizeOpenLibraryBook)
    .filter((book) => book.sourceId);
}

export async function fetchWorkDescription(sourceId) {
  try {
    const work = await cached(
      `openlibrary:work:${sourceId}`,
      24 * 60 * 60_000,
      () => fetchJson(`${OPEN_LIBRARY_BOOK}/works/${encodeURIComponent(sourceId)}.json`)
    );
    if (typeof work.description === "string") return cleanDescription(work.description);
    return cleanDescription(work.description?.value);
  } catch {
    return null;
  }
}

async function findAppleBooksUrl(book) {
  const term = book.isbn13 || `${book.title} ${book.author}`;
  try {
    const url = new URL(APPLE_SEARCH);
    url.searchParams.set("term", term);
    url.searchParams.set("media", "ebook");
    url.searchParams.set("entity", "ebook");
    url.searchParams.set("limit", "1");
    const payload = await fetchJson(url);
    return payload.results?.[0]?.trackViewUrl || null;
  } catch {
    return null;
  }
}

async function findGoogleBooksMetadata(book) {
  try {
    const url = new URL(GOOGLE_BOOKS_SEARCH);
    url.searchParams.set(
      "q",
      book.isbn13 ? `isbn:${book.isbn13}` : `intitle:${book.title} inauthor:${book.author}`
    );
    url.searchParams.set("maxResults", "1");
    url.searchParams.set(
      "fields",
      "items(volumeInfo(description,previewLink,infoLink,publishedDate,language))"
    );
    const payload = await fetchJson(url);
    const info = payload.items?.[0]?.volumeInfo;
    return {
      description: cleanDescription(info?.description),
      previewUrl: info?.previewLink || info?.infoLink || null,
      language: info?.language || null
    };
  } catch {
    return { description: null, previewUrl: null, language: null };
  }
}

export async function getOpenLibraryBook(sourceId) {
  const matches = await searchOpenLibrary(`key:/works/${sourceId}`, 1);
  const book = matches.find((item) => item.sourceId === sourceId) || matches[0];
  if (!book) {
    const error = new Error("No se encontró el libro en Open Library.");
    error.status = 404;
    throw error;
  }
  const [description, appleBooksUrl, googleBooks] = await Promise.all([
    fetchWorkDescription(sourceId),
    findAppleBooksUrl(book),
    findGoogleBooksMetadata(book)
  ]);
  return {
    ...book,
    synopsis: description || googleBooks.description || book.synopsis,
    appleBooksUrl,
    previewUrl: googleBooks.previewUrl || book.previewUrl,
    language: book.language || googleBooks.language
  };
}

export async function translateBook(book, language, config) {
  if (!language || !config?.translationApiUrl) return book;
  const values = [book.title, book.synopsis].filter(Boolean);
  if (!values.length) return book;
  try {
    const payload = await cached(
      `translation:${language}:${book.source}:${book.sourceId}`,
      7 * 24 * 60 * 60_000,
      async () => {
        const response = await fetch(config.translationApiUrl, {
          method: "POST",
          signal: AbortSignal.timeout(8_000),
          headers: {
            "Content-Type": "application/json",
            ...(config.translationApiKey
              ? { Authorization: `Bearer ${config.translationApiKey}` }
              : {})
          },
          body: JSON.stringify({
            q: values,
            source: "auto",
            target: language,
            format: "text",
            api_key: config.translationApiKey || undefined
          })
        });
        if (!response.ok) throw new Error("Translation unavailable");
        return response.json();
      }
    );
    const translated = Array.isArray(payload.translatedText)
      ? payload.translatedText
      : [payload.translatedText];
    return {
      ...book,
      title: translated[0] || book.title,
      synopsis: translated[1] || book.synopsis,
      translated: true
    };
  } catch {
    return book;
  }
}

export async function translateBookTitles(books, language, config) {
  if (!books.length || !language || !config?.translationApiUrl) return books;
  const chunks = [];
  for (let index = 0; index < books.length; index += 2) {
    chunks.push(books.slice(index, index + 2));
  }
  const localizedChunks = await Promise.all(chunks.map(async (chunk) => {
    const key = chunk.map((book) => `${book.source}:${book.sourceId}`).join(",");
    try {
      const payload = await cached(
        `title-batch:${language}:${key}`,
        7 * 24 * 60 * 60_000,
        async () => {
          const response = await fetch(config.translationApiUrl, {
            method: "POST",
            signal: AbortSignal.timeout(60_000),
            headers: {
              "Content-Type": "application/json",
              ...(config.translationApiKey
                ? { Authorization: `Bearer ${config.translationApiKey}` }
                : {})
            },
            body: JSON.stringify({
              q: chunk.map((book) => book.title),
              source: "auto",
              target: language,
              format: "text",
              api_key: config.translationApiKey || undefined
            })
          });
          if (!response.ok) throw new Error("Translation unavailable");
          return response.json();
        }
      );
      const titles = Array.isArray(payload.translatedText)
        ? payload.translatedText
        : [payload.translatedText];
      return chunk.map((book, index) => ({
        ...book,
        title: titles[index] || book.title,
        translated: true
      }));
    } catch {
      return chunk;
    }
  }));
  return localizedChunks.flat();
}
