ALTER TABLE books
  ADD COLUMN IF NOT EXISTS progress_unit VARCHAR(20) NOT NULL DEFAULT 'page',
  ADD COLUMN IF NOT EXISTS progress_total_known BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE books DROP CONSTRAINT IF EXISTS books_progress_unit_check;
ALTER TABLE books
  ADD CONSTRAINT books_progress_unit_check
  CHECK (progress_unit IN ('page', 'chapter'));

UPDATE books
SET progress_unit = 'chapter',
    progress_total_known = (pages > 1)
WHERE catalog_source = 'anilist';

