-- Kadena 2048 joins the games, and a round can be Expert (harder puzzle, usually a bigger prize).
ALTER TABLE task_campaigns DROP CONSTRAINT IF EXISTS task_campaigns_game_check;
ALTER TABLE task_campaigns ADD CONSTRAINT task_campaigns_game_check CHECK (game IN ('tiles','quiz','logic','riddle','word','memory','mines','pactbug','k2048'));
ALTER TABLE task_campaigns ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'normal' CHECK (difficulty IN ('normal','expert'));
