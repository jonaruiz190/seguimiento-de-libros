import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTrackingItem } from "../server/routes/tracking.js";

function poolWithBook(book) {
  return {
    async query() {
      return { rowCount: 1, rows: [book] };
    }
  };
}

const baseItem = {
  bookId: "book-1",
  status: "Leyendo",
  format: "Digital",
  readingProvider: "Webtoons",
  currentPage: 250
};

test("no limita capítulos cuando el total de AniList es desconocido", async () => {
  const item = await normalizeTrackingItem(
    poolWithBook({ pages: 1, progressTotalKnown: false }),
    baseItem
  );

  assert.equal(item.currentPage, 250);
});

test("mantiene el límite cuando el total del libro es conocido", async () => {
  const item = await normalizeTrackingItem(
    poolWithBook({ pages: 200, progressTotalKnown: true }),
    baseItem
  );

  assert.equal(item.currentPage, 200);
});
