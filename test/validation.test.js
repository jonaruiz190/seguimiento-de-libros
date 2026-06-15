import assert from "node:assert/strict";
import test from "node:test";
import {
  loginSchema,
  profileSchema,
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

test("valida cambios de perfil y contraseña", () => {
  const profile = validate(profileSchema, {
    name: "Ana Torres",
    avatarUrl: "https://example.com/avatar.jpg",
    currentPassword: "",
    newPassword: ""
  });
  assert.equal(profile.avatarUrl, "https://example.com/avatar.jpg");

  assert.throws(() => validate(profileSchema, {
    name: "Ana Torres",
    avatarUrl: null,
    currentPassword: "",
    newPassword: "NuevaClave2026"
  }), /no son válidos/);

  assert.throws(() => validate(profileSchema, {
    name: "Ana Torres",
    avatarUrl: "javascript:alert(1)",
    currentPassword: "",
    newPassword: ""
  }), /no son válidos/);
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
    readingProvider: null,
    currentPage: null
  }), /no son válidos/);
});

test("acepta lecturas en pausa y abandonadas", () => {
  for (const status of ["En pausa", "Abandonado"]) {
    const result = validate(trackingSchema, {
      bookId: "dune",
      status,
      rating: 0,
      comment: "",
      format: "Digital",
      startedAt: "2026-06-01",
      finishedAt: null,
      readingProvider: "Kindle",
      currentPage: 42
    });
    assert.equal(result.status, status);
  }
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
    readingProvider: "Kindle",
    currentPage: 120
  }), /no son válidos/);
});

test("acepta seguimiento en formato ambos con Webtoons", () => {
  const result = validate(trackingSchema, {
    bookId: "tower-of-god",
    status: "Leyendo",
    rating: 4,
    comment: "",
    format: "Ambos",
    startedAt: "2026-06-01",
    finishedAt: null,
    readingProvider: "Webtoons",
    currentPage: 12
  });

  assert.equal(result.format, "Ambos");
  assert.equal(result.readingProvider, "Webtoons");
});
