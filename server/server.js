import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";

const config = loadConfig();
const pool = createPool(config);
const app = createApp({ pool, config });
const server = app.listen(config.port, () => {
  console.log(`Seguimiento de Libros disponible en ${config.appOrigin}`);
});

async function shutdown(signal) {
  console.log(`${signal} recibido. Cerrando servidor...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
