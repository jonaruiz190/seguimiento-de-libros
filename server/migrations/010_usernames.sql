ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username VARCHAR(30);

UPDATE users
SET username = 'reader_' || SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 8)
WHERE username IS NULL;

ALTER TABLE users
  ALTER COLUMN username SET NOT NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_username_format_check;

ALTER TABLE users
  ADD CONSTRAINT users_username_format_check
  CHECK (username ~ '^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$');

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
  ON users (LOWER(username));
