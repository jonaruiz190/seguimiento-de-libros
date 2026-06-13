import assert from "node:assert/strict";
import test from "node:test";
import {
  profileSchema,
  rankingSchema,
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
