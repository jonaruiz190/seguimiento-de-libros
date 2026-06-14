ALTER TABLE tracking
  DROP CONSTRAINT IF EXISTS tracking_format_check;

ALTER TABLE tracking
  ADD CONSTRAINT tracking_format_check
  CHECK (format IN ('Físico', 'Digital', 'Ambos'));

ALTER TABLE tracking
  DROP CONSTRAINT IF EXISTS tracking_reading_provider_check;

ALTER TABLE tracking
  ADD CONSTRAINT tracking_reading_provider_check
  CHECK (
    reading_provider IS NULL OR
    reading_provider IN (
      'Kindle', 'Apple Books', 'Google Books', 'Webtoons', 'Otro'
    )
  );
