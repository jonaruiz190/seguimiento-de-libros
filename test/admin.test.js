import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../server/app.js";

const config = {
  isProduction: true,
  appOrigin: "https://libros.example",
  allowedOrigins: ["https://libros.example"],
  allowRegistration: false,
  sessionDays: 7,
  trustProxy: 0
};

test("la primera cuenta se crea como administrador aunque el registro este cerrado", async () => {
  let insertedRole;
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Propietario",
    username: "propietario",
    email: "owner@example.com",
    role: "admin",
    is_active: true,
    email_verified_at: new Date()
  };
  const client = {
    query: async (sql, params = []) => {
      if (sql.includes("COUNT(*)")) return { rowCount: 1, rows: [{ total: 0 }] };
      if (sql.includes("INSERT INTO users")) {
        insertedRole = params[4];
        return { rowCount: 1, rows: [user] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const pool = {
    query: async (sql) => {
      if (sql.includes("COUNT(*)")) return { rowCount: 1, rows: [{ total: 0 }] };
      return { rowCount: 0, rows: [] };
    },
    connect: async () => client
  };

  const response = await request(createApp({ pool, config }))
    .post("/api/auth/register")
    .send({
      name: user.name,
      username: user.username,
      email: user.email,
      password: "Lecturas2026!",
      preferences: []
    });

  assert.equal(response.status, 201);
  assert.equal(insertedRole, "admin");
  assert.equal(response.body.user.isAdmin, true);
});

test("una base con usuarios exige invitacion para registrar otra cuenta", async () => {
  const pool = {
    query: async () => ({ rowCount: 1, rows: [{ total: 1 }] })
  };
  const response = await request(createApp({ pool, config }))
    .post("/api/auth/register")
    .send({
      name: "Sin invitacion",
      username: "sin.invitacion",
      email: "sin-invitacion@example.com",
      password: "Lecturas2026!",
      preferences: []
    });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "Necesitas una invitación para crear la cuenta.");
});

test("una invitacion no puede utilizarse con otro correo", async () => {
  const token = "a".repeat(43);
  const client = {
    query: async (sql) => {
      if (sql.includes("COUNT(*)")) return { rowCount: 1, rows: [{ total: 1 }] };
      if (sql.includes("FROM user_invitations")) {
        return {
          rowCount: 1,
          rows: [{ id: "invite-1", email: "invitado@example.com", role: "user" }]
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const pool = {
    query: async () => ({ rowCount: 1, rows: [{ total: 1 }] }),
    connect: async () => client
  };
  const response = await request(createApp({ pool, config }))
    .post("/api/auth/register")
    .send({
      name: "Correo distinto",
      username: "correo.distinto",
      email: "otro@example.com",
      password: "Lecturas2026!",
      preferences: [],
      invitationToken: token
    });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "La invitación pertenece a otro correo.");
});

test("un usuario normal no puede consultar el panel administrativo", async () => {
  const pool = {
    query: async (sql) => {
      if (sql.includes("FROM sessions s")) {
        return {
          rowCount: 1,
          rows: [{
            id: "user-1",
            name: "Lector",
            username: "lector",
            email: "lector@example.com",
            role: "user",
            is_active: true
          }]
        };
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    }
  };
  const response = await request(createApp({ pool, config }))
    .get("/api/admin/overview")
    .set("Cookie", "sid=session-token");

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "Se requieren permisos de administrador.");
});

test("el administrador no puede quitarse sus propios permisos", async () => {
  const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const pool = {
    query: async (sql) => {
      if (sql.includes("FROM sessions s")) {
        return {
          rowCount: 1,
          rows: [{
            id: adminId,
            name: "Admin",
            username: "admin",
            email: "admin@example.com",
            role: "admin",
            is_active: true
          }]
        };
      }
      throw new Error(`Consulta inesperada: ${sql}`);
    }
  };
  const response = await request(createApp({ pool, config }))
    .patch(`/api/admin/users/${adminId}`)
    .set("Cookie", "sid=session-token")
    .set("Origin", config.appOrigin)
    .send({ role: "user", isActive: true });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /propios permisos/);
});
