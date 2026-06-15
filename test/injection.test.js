import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import test from "node:test";
import request from "supertest";
import { createApp } from "../server/app.js";

const config = {
  isProduction: false,
  appOrigin: "http://localhost:3000",
  allowedOrigins: ["http://localhost:3000"],
  sessionDays: 7,
  trustProxy: 0
};

test("rechaza una inyección SQL en el correo antes de consultar la base", async () => {
  let queried = false;
  const pool = {
    query: async () => {
      queried = true;
      return { rowCount: 0, rows: [] };
    }
  };
  const response = await request(createApp({ pool, config }))
    .post("/api/auth/login")
    .send({
      email: "' OR 1=1; DROP TABLE users; --",
      password: "Password2026!"
    });

  assert.equal(response.status, 400);
  assert.equal(queried, false);
});

test("mantiene los identificadores maliciosos fuera del texto SQL", async () => {
  const payload = "x'; DROP TABLE tracking; --";
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM sessions s")) {
        return {
          rowCount: 1,
          rows: [{ id: "user-1", name: "Ana", email: "ana@example.com" }]
        };
      }
      return { rowCount: 0, rows: [] };
    }
  };
  const response = await request(createApp({ pool, config }))
    .delete(`/api/tracking/${encodeURIComponent(payload)}`)
    .set("Cookie", "sid=session-token")
    .set("Origin", config.appOrigin);

  assert.equal(response.status, 404);
  const mutation = calls.find((call) => call.sql.includes("UPDATE tracking"));
  assert.ok(mutation);
  assert.equal(mutation.sql.includes(payload), false);
  assert.equal(mutation.params[0], payload);
});

test("el servidor no incluye primitivas de ejecución de comandos", async () => {
  const files = [];
  for await (const file of glob("server/**/*.js")) files.push(file);
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");

  assert.doesNotMatch(source, /node:child_process|require\(["']child_process["']\)/);
  assert.doesNotMatch(source, /\b(?:exec|execFile|spawn|fork)\s*\(/);
});

test("no expone el archivo .env mediante traversal", async () => {
  const pool = { query: async () => ({ rowCount: 0, rows: [] }) };
  const response = await request(createApp({ pool, config })).get("/..%2f.env");

  assert.match(response.headers["content-type"], /text\/html/);
  assert.doesNotMatch(response.text || "", /DATABASE_URL|SPOTIFY_CLIENT_SECRET|NYT_BOOKS_API_KEY/);
});
