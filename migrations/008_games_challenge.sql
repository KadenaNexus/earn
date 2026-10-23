-- Daily Challenge (same Sliding Tiles board for everyone each UTC day), streaks and bonus pools.
CREATE TABLE IF NOT EXISTS challenge_entries (
 day DATE NOT NULL,
 user_id BIGINT NOT NULL REFERENCES users(id),
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 finished_at TIMESTAMPTZ,
 moves INT,
 seconds DOUBLE PRECISION,
 flags JSONB,
 PRIMARY KEY (day, user_id)
);
CREATE INDEX IF NOT EXISTS challenge_entries_rank ON challenge_entries(day, moves, seconds) WHERE finished_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS challenge_days (
 day DATE PRIMARY KEY,
 awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 winners JSONB NOT NULL DEFAULT '[]'
);
-- A bonus pool is a hidden, funded campaign whose prizes are awarded by the server
-- (Daily Challenge top 3, or a 7-day streak) and approved by the owner in Admin.
ALTER TABLE task_campaigns ADD COLUMN IF NOT EXISTS bonus_kind TEXT CHECK (bonus_kind IS NULL OR bonus_kind IN ('challenge','streak'));
CREATE INDEX IF NOT EXISTS game_sessions_finished ON game_sessions(user_id, finished_at) WHERE finished_at IS NOT NULL;
