-- Private question banks uploaded by the owner (replace the public built-in bank of that kind),
-- and which items each wallet has seen, so repeat players rarely get the same question twice.
CREATE TABLE IF NOT EXISTS game_content (
 kind TEXT PRIMARY KEY CHECK (kind IN ('quiz','written','riddles','words','pactbugs')),
 items JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS game_seen (
 user_id BIGINT NOT NULL REFERENCES users(id),
 item_key TEXT NOT NULL,
 seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, item_key)
);
