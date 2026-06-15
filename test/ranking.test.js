import assert from "node:assert/strict";
import test from "node:test";
import { filterAndRankNytBooks } from "../server/routes/catalog.js";

const books = [
  {
    title: "Fantasy One",
    author: "Jane Example",
    categories: ["Hardcover Fiction"],
    weeksOnList: 8,
    rank: 3
  },
  {
    title: "Business One",
    author: "John Example",
    categories: ["Business Books"],
    weeksOnList: 15,
    rank: 2
  },
  {
    title: "Fantasy Two",
    author: "Jane Example",
    categories: ["Trade Paperback Fiction"],
    weeksOnList: 15,
    rank: 1
  }
];

test("filtra best sellers de NYT por autor y categoría", () => {
  const result = filterAndRankNytBooks(books, {
    author: "jane",
    category: "Fantasía"
  });

  assert.deepEqual(result.map((book) => book.title), ["Fantasy Two", "Fantasy One"]);
  assert.deepEqual(result.map((book) => book.rank), [1, 2]);
});

test("ordena el historial NYT por semanas y mejor posición", () => {
  const result = filterAndRankNytBooks(books, {});

  assert.deepEqual(
    result.map((book) => book.title),
    ["Fantasy Two", "Business One", "Fantasy One"]
  );
});
