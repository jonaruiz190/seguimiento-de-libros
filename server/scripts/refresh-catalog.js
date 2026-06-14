import { loadConfig } from "../config.js";
import { createPool } from "../db.js";
import { getOpenLibraryBook } from "../services/catalog.js";

const config = loadConfig();
const pool = createPool(config);
let updated = 0;
let failed = 0;

try {
  const catalogBooks = await pool.query(
    `SELECT id, source_id AS "sourceId"
     FROM books
     WHERE catalog_source = 'openlibrary' AND source_id IS NOT NULL
     ORDER BY metadata_synced_at ASC NULLS FIRST`
  );

  for (const row of catalogBooks.rows) {
    try {
      const book = await getOpenLibraryBook(row.sourceId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE books SET
             title = $1, author = $2, publication_year = $3, pages = $4,
             cover_url = $5, synopsis = $6, isbn_13 = $7, publisher = $8,
             language = $9, preview_url = $10, apple_books_url = $11,
             kindle_url = $12, progress_unit = $13, progress_total_known = $14,
             metadata_synced_at = NOW(), updated_at = NOW()
           WHERE id = $15`,
          [
            book.title, book.author, book.year, book.pages, book.cover,
            book.synopsis, book.isbn13, book.publisher, book.language,
            book.previewUrl, book.appleBooksUrl, book.kindleUrl,
            book.progressUnit || "page", book.progressTotalKnown !== false, row.id
          ]
        );
        await client.query("DELETE FROM book_categories WHERE book_id = $1", [row.id]);
        for (const category of book.categories.length ? book.categories : ["General"]) {
          await client.query(
            "INSERT INTO book_categories (book_id, category) VALUES ($1, $2)",
            [row.id, category]
          );
        }
        await client.query("COMMIT");
        updated += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      failed += 1;
      console.error(`No se pudo actualizar ${row.sourceId}: ${error.message}`);
    }
  }

  console.log(`Catálogo actualizado: ${updated} libros; ${failed} errores.`);
} finally {
  await pool.end();
}
