import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createPool } from "../db.js";
import { hashPassword } from "../security.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const booksPath = path.resolve(currentDirectory, "../../data/books.json");
const books = JSON.parse(await fs.readFile(booksPath, "utf8"));
const config = loadConfig();
const pool = createPool(config);
const demoUserId = "11111111-1111-4111-8111-111111111111";

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const book of books) {
      await client.query(
        `INSERT INTO books
          (id, title, author, publication_year, pages, rating, cover_url, synopsis)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           author = EXCLUDED.author,
           publication_year = EXCLUDED.publication_year,
           pages = EXCLUDED.pages,
           rating = EXCLUDED.rating,
           cover_url = EXCLUDED.cover_url,
           synopsis = EXCLUDED.synopsis,
           updated_at = NOW()`,
        [
          book.id,
          book.title,
          book.author,
          book.year,
          book.pages,
          book.rating,
          book.cover,
          book.synopsis
        ]
      );
      await client.query("DELETE FROM book_categories WHERE book_id = $1", [book.id]);
      for (const category of book.categories) {
        await client.query(
          "INSERT INTO book_categories (book_id, category) VALUES ($1, $2)",
          [book.id, category]
        );
      }
    }

    const existingDemo = await client.query("SELECT 1 FROM users WHERE id = $1", [demoUserId]);
    if (!existingDemo.rowCount) {
      const passwordHash = await hashPassword("libros123");
      await client.query(
        `INSERT INTO users (id, name, email, password_hash)
         VALUES ($1, $2, $3, $4)`,
        [demoUserId, "Ana Torres", "ana@libros.com", passwordHash]
      );
      for (const category of ["Fantasía", "Clásicos", "Realismo mágico"]) {
        await client.query(
          "INSERT INTO user_preferences (user_id, category) VALUES ($1, $2)",
          [demoUserId, category]
        );
      }
      await client.query(
        `INSERT INTO tracking
          (user_id, book_id, status, rating, comment, format,
           started_at, finished_at, reading_minutes)
         VALUES
           ($1, 'cien-anos', 'Leyendo', 5, 'La atmósfera de Macondo es inolvidable.',
            'Físico', CURRENT_DATE - 12, NULL, 420),
           ($1, 'dune', 'Próximo a leer', 0, 'Recomendación de un amigo.',
            'Digital', NULL, NULL, 0),
           ($1, 'orgullo-prejuicio', 'Leído', 4,
            'Diálogos brillantes y personajes memorables.', 'Físico',
            CURRENT_DATE - 48, CURRENT_DATE - 31, 780)`,
        [demoUserId]
      );
    }

    await client.query(
      `UPDATE tracking SET
         started_at = COALESCE(started_at, CURRENT_DATE - 12),
         reading_minutes = CASE WHEN reading_minutes = 0 THEN 420 ELSE reading_minutes END
       WHERE user_id = $1 AND book_id = 'cien-anos'`,
      [demoUserId]
    );
    await client.query(
      `UPDATE tracking SET
         started_at = COALESCE(started_at, CURRENT_DATE - 48),
         finished_at = COALESCE(finished_at, CURRENT_DATE - 31),
         reading_minutes = CASE WHEN reading_minutes = 0 THEN 780 ELSE reading_minutes END
       WHERE user_id = $1 AND book_id = 'orgullo-prejuicio'`,
      [demoUserId]
    );

    await client.query("COMMIT");
    console.log(`Datos iniciales listos: ${books.length} libros y usuario de demostración.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
