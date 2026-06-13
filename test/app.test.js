import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../server/app.js";

const config = {
  isProduction: false,
  appOrigin: "http://localhost:3000",
  sessionDays: 7,
  trustProxy: 0
};

test("expone health check y cabeceras de seguridad", async () => {
  const pool = {
    query: async (sql) => {
      assert.match(sql, /SELECT 1/);
      return { rowCount: 1, rows: [{ "?column?": 1 }] };
    }
  };
  const response = await request(createApp({ pool, config })).get("/api/health");

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "ok");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-powered-by"], undefined);
});

test("no expone archivos internos del antiguo almacenamiento JSON", async () => {
  const pool = { query: async () => ({ rowCount: 1, rows: [] }) };
  const response = await request(createApp({ pool, config })).get("/data/users.json");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.match(response.text.trimStart(), /^<!DOCTYPE html>/);
  assert.doesNotMatch(response.text, /"password"\s*:/);
});

test("bloquea mutaciones autenticadas desde otro origen", async () => {
  const pool = { query: async () => ({ rowCount: 0, rows: [] }) };
  const response = await request(createApp({ pool, config }))
    .post("/api/tracking")
    .set("Cookie", "sid=token")
    .set("Origin", "https://sitio-malicioso.example")
    .send({});

  assert.equal(response.status, 403);
});

test("registra un usuario y crea una cookie de sesión HttpOnly", async () => {
  const user = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Lucía Pérez",
    email: "lucia@example.com"
  };
  const client = {
    query: async (sql) => {
      if (sql.includes("RETURNING id, name, email")) {
        return { rowCount: 1, rows: [user] };
      }
      return { rowCount: 1, rows: [] };
    },
    release: () => {}
  };
  const pool = {
    connect: async () => client,
    query: async (sql) => {
      if (sql.includes("SELECT category")) {
        return { rowCount: 1, rows: [{ category: "Fantasía" }] };
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const response = await request(createApp({ pool, config }))
    .post("/api/auth/register")
    .send({
      name: user.name,
      email: user.email,
      password: "Lecturas2026!",
      preferences: ["Fantasía"]
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.user.email, user.email);
  assert.equal("password" in response.body.user, false);
  assert.match(response.headers["set-cookie"][0], /HttpOnly/);
  assert.match(response.headers["set-cookie"][0], /SameSite=Lax/);
});
