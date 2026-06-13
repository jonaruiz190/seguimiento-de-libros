import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogSearchSchema,
  dashboardFilterSchema,
  forgotPasswordSchema,
  profileSchema,
  rankingSchema,
  resetPasswordSchema,
  spotifySearchSchema,
  validate
} from "../server/validation.js";

test("acepta preferencias ampliadas y avatar local en el perfil", () => {
  const profile = validate(profileSchema, {
    name: "Ana Torres",
    avatarUrl: "data:image/png;base64,aGVsbG8=",
    language: "en",
    preferences: ["Manga", "Fantasía"],
    favoriteAuthors: ["Ursula K. Le Guin"],
    spotifyPlaylistUrl: "https://open.spotify.com/playlist/abc123",
    currentPassword: "",
    newPassword: ""
  });
  assert.equal(profile.language, "en");
  assert.equal(profile.favoriteAuthors[0], "Ursula K. Le Guin");
});

test("normaliza filtros del Top 100", () => {
  const ranking = validate(rankingSchema, {
    category: "Manga",
    minRating: "4.5",
    year: "2024",
    language: "es"
  });
  assert.equal(ranking.minRating, 4.5);
  assert.equal(ranking.year, 2024);
});

test("valida catálogo mixto y búsquedas de Spotify", () => {
  const catalog = validate(catalogSearchSchema, {
    q: "Solo Leveling",
    source: "anilist",
    language: "es"
  });
  const spotify = validate(spotifySearchSchema, {
    q: "música para leer",
    type: "playlist"
  });
  assert.equal(catalog.source, "anilist");
  assert.equal(spotify.type, "playlist");
});

test("valida recuperación de contraseña y filtros del dashboard", () => {
  const recovery = validate(forgotPasswordSchema, {
    email: "  LECTORA@EXAMPLE.COM "
  });
  const reset = validate(resetPasswordSchema, {
    token: "a".repeat(43),
    password: "NuevaClave2026!"
  });
  const filters = validate(dashboardFilterSchema, {
    from: "2026-01-01",
    to: "2026-06-13",
    format: "Digital",
    provider: "Kindle"
  });

  assert.equal(recovery.email, "lectora@example.com");
  assert.equal(reset.token.length, 43);
  assert.equal(filters.provider, "Kindle");
  assert.throws(() => validate(dashboardFilterSchema, {
    from: "2026-06-13",
    to: "2026-01-01"
  }), /no son válidos/);
});
