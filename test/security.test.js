import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookies,
  verifyPassword
} from "../server/security.js";
import {
  decryptSecret,
  encryptSecret,
  hashOauthState
} from "../server/integration-security.js";

test("hashPassword crea hashes con sal y verifica la contraseña correcta", async () => {
  const first = await hashPassword("una-clave-segura");
  const second = await hashPassword("una-clave-segura");

  assert.notEqual(first, second);
  assert.equal(await verifyPassword("una-clave-segura", first), true);
  assert.equal(await verifyPassword("clave-incorrecta", first), false);
});

test("los tokens de sesión son aleatorios y se guardan como hash", () => {
  const token = createSessionToken();
  const anotherToken = createSessionToken();

  assert.notEqual(token, anotherToken);
  assert.equal(token.length >= 40, true);
  assert.match(hashSessionToken(token), /^[a-f0-9]{64}$/);
  assert.notEqual(hashSessionToken(token), token);
});

test("parseCookies interpreta cookies sin perder valores con signos igual", () => {
  assert.deepEqual(parseCookies("sid=abc%3D123; theme=dark"), {
    sid: "abc=123",
    theme: "dark"
  });
});

test("cifra tokens externos y permite recuperarlos con la clave correcta", () => {
  const encrypted = encryptSecret("spotify-token", "clave-de-prueba");
  assert.notEqual(encrypted, "spotify-token");
  assert.equal(decryptSecret(encrypted, "clave-de-prueba"), "spotify-token");
  assert.match(hashOauthState("estado"), /^[a-f0-9]{64}$/);
});
