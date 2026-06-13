ALTER TABLE users
  ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'es',
  ADD COLUMN IF NOT EXISTS spotify_playlist_url TEXT;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_language_check;

ALTER TABLE users
  ADD CONSTRAINT users_language_check CHECK (language IN ('es', 'en', 'fr', 'de', 'it', 'pt'));

CREATE TABLE IF NOT EXISTS user_favorite_authors (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author VARCHAR(180) NOT NULL,
  PRIMARY KEY (user_id, author)
);

ALTER TABLE tracking
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS tracking_user_active_idx
  ON tracking(user_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS book_translations (
  book_id VARCHAR(100) NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  language VARCHAR(10) NOT NULL,
  title VARCHAR(250),
  synopsis TEXT,
  translated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (book_id, language)
);
