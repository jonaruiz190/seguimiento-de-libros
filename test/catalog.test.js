import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAniListMedia } from "../server/services/anilist.js";
import { normalizeOpenLibraryBook } from "../server/services/catalog.js";

test("normaliza resultados de Open Library para el catálogo local", () => {
  const book = normalizeOpenLibraryBook({
    key: "/works/OL123W",
    title: "Libro de prueba",
    author_name: ["Autora"],
    first_publish_year: 2020,
    number_of_pages_median: 320,
    isbn: ["1234567890", "9781234567890"],
    subject: ["Fantasía", "Fantasía", "Aventura", "award:hugo=1970"],
    cover_i: 42,
    language: ["spa"],
    publisher: ["Editorial"],
    ratings_average: 4.25,
    ratings_count: 120,
    already_read_count: 450
  });

  assert.equal(book.sourceId, "OL123W");
  assert.equal(book.isbn13, "9781234567890");
  assert.deepEqual(book.categories, ["Fantasía", "Aventura"]);
  assert.match(book.cover, /^https:\/\/covers\.openlibrary\.org/);
  assert.match(book.kindleUrl, /amazon\.com/);
  assert.equal(book.rating, 4.25);
  assert.equal(book.readersCount, 450);
  assert.equal(book.progressTotalKnown, true);
  assert.equal(book.progressUnit, "page");
});

test("mantiene abierto el progreso de publicaciones activas de AniList", () => {
  const book = normalizeAniListMedia({
    id: 123,
    title: { english: "Omniscient Reader" },
    chapters: null,
    volumes: 10,
    countryOfOrigin: "KR",
    genres: [],
    staff: { edges: [] },
    coverImage: {}
  }, "es");

  assert.equal(book.pages, 1);
  assert.equal(book.progressUnit, "chapter");
  assert.equal(book.progressTotalKnown, false);
});
