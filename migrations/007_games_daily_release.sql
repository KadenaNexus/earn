-- A game round can release a few prizes per day (reset at 00:00 UTC) instead of all at once,
-- so a large funded pool keeps the board stocked for days.
ALTER TABLE task_campaigns ADD COLUMN IF NOT EXISTS daily_release INT CHECK (daily_release IS NULL OR daily_release > 0);
