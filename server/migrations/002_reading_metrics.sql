ALTER TABLE tracking
  ADD COLUMN IF NOT EXISTS started_at DATE,
  ADD COLUMN IF NOT EXISTS finished_at DATE,
  ADD COLUMN IF NOT EXISTS reading_minutes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE tracking
  DROP CONSTRAINT IF EXISTS tracking_reading_minutes_check;

ALTER TABLE tracking
  ADD CONSTRAINT tracking_reading_minutes_check
  CHECK (reading_minutes BETWEEN 0 AND 1000000);

ALTER TABLE tracking
  DROP CONSTRAINT IF EXISTS tracking_dates_check;

ALTER TABLE tracking
  ADD CONSTRAINT tracking_dates_check
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at);

CREATE INDEX IF NOT EXISTS tracking_user_finished_at_idx
  ON tracking(user_id, finished_at);
