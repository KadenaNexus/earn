-- More Kadena Nexus Games: Kadena Word, Memory Match, Minesweeper, Spot the Pact Bug.
-- Interactive rounds keep their move-by-move progress in game_sessions.state.
ALTER TABLE task_campaigns DROP CONSTRAINT IF EXISTS task_campaigns_game_check;
ALTER TABLE task_campaigns ADD CONSTRAINT task_campaigns_game_check CHECK (game IN ('tiles','quiz','logic','riddle','word','memory','mines','pactbug'));
ALTER TABLE game_sessions ADD COLUMN state JSONB;
