import assert from "node:assert/strict";
import test from "node:test";
import {
  loginSchema,
  registerSchema,
  trackingSchema,
  validate
} from "../server/validation.js";

test("normaliza el correo de login", () => {
  const result = validate(loginSchema, {
    email: "  ANA@LIBROS.COM ",
    password: "libros123"
  });
  assert.equal(result.email, "ana@libros.com");
});

test("exige contraseñas robustas para nuevos usuarios", () => {
  assert.throws(() => validate(registerSchema, {
    name: "Nueva lectora",
    email: "lectora@example.com",
    password: "demasiado-simple",
    preferences: []
  }), /no son válidos/);

  const result = validate(registerSchema, {
    name: "Nueva lectora",
    email: "lectora@example.com",
    password: "Lecturas2026!",
    preferences: ["Fantasía"]
  });
  assert.equal(result.email, "lectora@example.com");
});

test("rechaza estados y puntuaciones inválidos", () => {
  assert.throws(() => validate(trackingSchema, {
    bookId: "dune",
    status: "Abandonado",
    rating: 8,
    comment: "",
    format: "Digital",
    startedAt: null,
    finishedAt: null,
    readingMinutes: 0,
    readingProvider: null,
    readingUrl: null,
    currentPage: null
  }), /no son válidos/);
});

test("rechaza una finalización anterior al inicio", () => {
  assert.throws(() => validate(trackingSchema, {
    bookId: "dune",
    status: "Leído",
    rating: 5,
    comment: "",
    format: "Digital",
    startedAt: "2026-06-10",
    finishedAt: "2026-06-01",
    readingMinutes: 600,
    readingProvider: "Kindle",
    readingUrl: "https://read.amazon.com/",
    currentPage: 120
  }), /no son válidos/);
});
