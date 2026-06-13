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
    format: "Digital"
  }), /no son válidos/);
});
