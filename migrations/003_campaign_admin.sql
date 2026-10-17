-- Owner can hide a task from the board (no new starts) and edit its text.
-- Reward, slots, sponsor and deadline stay as funded on chain.
ALTER TABLE task_campaigns ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE task_campaigns ADD COLUMN updated_at TIMESTAMPTZ;
