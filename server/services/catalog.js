const OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json";
const OPEN_LIBRARY_BOOK = "https://openlibrary.org";
const APPLE_SEARCH = "https://itunes.apple.com/search";

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
    .filter((value) => value && value.length <= 100))]
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
    rating: 0,
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
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15_000),
    headers: {
      "User-Agent": "SeguimientoDeLibros/1.0",
      ...options.headers
    }
  });
  if (!response.ok) {
    const error = new Error("El catálogo externo no está disponible temporalmente.");
    error.status = 502;
    throw error;
  }
  return response.json();
}

export async function searchOpenLibrary(query, limit = 12) {
  const url = new URL(OPEN_LIBRARY_SEARCH);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set(
    "fields",
    "key,title,author_name,first_publish_year,number_of_pages_median,isbn,subject,cover_i,language,publisher"
  );
  const payload = await fetchJson(url);
  return (payload.docs || [])
    .map(normalizeOpenLibraryBook)
    .filter((book) => book.sourceId);
}

async function fetchWorkDescription(sourceId) {
  try {
    const work = await fetchJson(`${OPEN_LIBRARY_BOOK}/works/${encodeURIComponent(sourceId)}.json`);
    if (typeof work.description === "string") return work.description;
    return work.description?.value || null;
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

export async function getOpenLibraryBook(sourceId) {
  const matches = await searchOpenLibrary(`key:/works/${sourceId}`, 1);
  const book = matches.find((item) => item.sourceId === sourceId) || matches[0];
  if (!book) {
    const error = new Error("No se encontró el libro en Open Library.");
    error.status = 404;
    throw error;
  }
  const [description, appleBooksUrl] = await Promise.all([
    fetchWorkDescription(sourceId),
    findAppleBooksUrl(book)
  ]);
  return {
    ...book,
    synopsis: description || book.synopsis,
    appleBooksUrl
  };
}
