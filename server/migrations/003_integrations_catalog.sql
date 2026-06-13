ALTER TABLE books
  ADD COLUMN IF NOT EXISTS isbn_13 VARCHAR(13),
  ADD COLUMN IF NOT EXISTS publisher VARCHAR(180),
  ADD COLUMN IF NOT EXISTS language VARCHAR(20),
  ADD COLUMN IF NOT EXISTS catalog_source VARCHAR(40) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_id VARCHAR(180),
  ADD COLUMN IF NOT EXISTS preview_url TEXT,
  ADD COLUMN IF NOT EXISTS apple_books_url TEXT,
  ADD COLUMN IF NOT EXISTS kindle_url TEXT,
  ADD COLUMN IF NOT EXISTS metadata_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS books_isbn_13_idx ON books(isbn_13);
CREATE UNIQUE INDEX IF NOT EXISTS books_catalog_source_id_idx
  ON books(catalog_source, source_id)
  WHERE source_id IS NOT NULL;

ALTER TABLE tracking
  ADD COLUMN IF NOT EXISTS reading_provider VARCHAR(30),
  ADD COLUMN IF NOT EXISTS reading_url TEXT,
  ADD COLUMN IF NOT EXISTS current_page INTEGER;

ALTER TABLE tracking
  DROP CONSTRAINT IF EXISTS tracking_reading_provider_check;

ALTER TABLE tracking
  ADD CONSTRAINT tracking_reading_provider_check
  CHECK (
    reading_provider IS NULL OR
    reading_provider IN ('Kindle', 'Apple Books', 'Google Books', 'Otro')
  );

ALTER TABLE tracking
  DROP CONSTRAINT IF EXISTS tracking_current_page_check;

ALTER TABLE tracking
  ADD CONSTRAINT tracking_current_page_check
  CHECK (current_page IS NULL OR current_page > 0);

CREATE TABLE IF NOT EXISTS spotify_connections (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(30) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oauth_states_expires_at_idx ON oauth_states(expires_at);
