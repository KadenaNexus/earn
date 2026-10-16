-- AI review agent (opt-in per campaign). The agent may approve or request
-- changes; rejection stays with the owner. Every agent call is recorded.
ALTER TABLE task_campaigns ADD COLUMN ai_review BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE task_campaigns ADD COLUMN ai_criteria TEXT;
ALTER TABLE submissions ADD COLUMN ai_reviewed BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE ai_reviews (
 id BIGSERIAL PRIMARY KEY,
 submission_id UUID NOT NULL REFERENCES submissions(id),
 proof_hash TEXT NOT NULL,
 model TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('approve','request_changes','escalate','error')),
 confidence NUMERIC(4,3),
 reasons TEXT,
 note TEXT,
 applied TEXT NOT NULL DEFAULT 'pending' CHECK(applied IN ('pending','approved','changes_requested','escalated','skipped')),
 skip_reason TEXT,
 -- Public receipt for an approved review: the exact text that was hashed, and
 -- its SHA-256, which is also written into the payout transaction's data.
 receipt TEXT,
 receipt_hash TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(submission_id,proof_hash)
);
CREATE INDEX ON ai_reviews(created_at);
-- Owner kill switch, independent of the emergency pause. Starts off.
INSERT INTO settings VALUES ('ai_review_enabled','false') ON CONFLICT DO NOTHING;
