-- Kadena Nexus Games: a game round is an ordinary escrow-funded campaign with
-- a game kind. Puzzles are generated and checked by the server; the proof is
-- written by the server, never typed by the player.
ALTER TABLE task_campaigns ADD COLUMN game TEXT CHECK (game IN ('tiles','quiz','logic','riddle'));
CREATE TABLE game_sessions (
 id UUID PRIMARY KEY,
 campaign_id BIGINT NOT NULL REFERENCES task_campaigns(id),
 user_id BIGINT NOT NULL REFERENCES users(id),
 game TEXT NOT NULL,
 puzzle JSONB NOT NULL,
 secret JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'playing' CHECK (status IN ('playing','solved','failed','expired')),
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL,
 finished_at TIMESTAMPTZ,
 play JSONB,
 result JSONB,
 submission_id UUID REFERENCES submissions(id)
);
CREATE INDEX ON game_sessions(campaign_id,user_id);
CREATE INDEX ON game_sessions(user_id,started_at);

-- Confirmed email to play for KDA. email_key is the normalized address
-- (lowercase, no +tag, Gmail dots removed) so one inbox backs one wallet.
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_key TEXT UNIQUE;
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;
CREATE TABLE email_tokens (
 token_hash TEXT PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id),
 email TEXT NOT NULL,
 email_key TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 used_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON email_tokens(user_id,created_at);
CREATE INDEX ON email_tokens(email_key,created_at);
