CREATE TABLE users (
 id BIGSERIAL PRIMARY KEY, kadena_account TEXT NOT NULL UNIQUE,
 display_name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE auth_nonces (
 nonce TEXT PRIMARY KEY, account TEXT NOT NULL, signing_request JSONB NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
 csrf TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE task_campaigns (
 id BIGSERIAL PRIMARY KEY, pact_campaign_id TEXT NOT NULL UNIQUE,
 sponsor_name TEXT NOT NULL, sponsor_account TEXT NOT NULL,
 title TEXT NOT NULL, summary TEXT NOT NULL, category TEXT NOT NULL, template TEXT NOT NULL,
 steps JSONB NOT NULL, proof_schema JSONB NOT NULL,
 reward_kda NUMERIC(18,6) NOT NULL CHECK(reward_kda>0),
 max_rewards INTEGER NOT NULL CHECK(max_rewards BETWEEN 1 AND 10000),
 minutes_estimate INTEGER NOT NULL CHECK(minutes_estimate>0), deadline TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','funding','open','ended','settled','funding_failed')),
 funding_tx TEXT UNIQUE, chain_snapshot JSONB, chain_checked_at TIMESTAMPTZ,
 featured BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE task_starts (
 id BIGSERIAL PRIMARY KEY, campaign_id BIGINT NOT NULL REFERENCES task_campaigns(id),
 user_id BIGINT NOT NULL REFERENCES users(id), expires_at TIMESTAMPTZ NOT NULL,
 state TEXT NOT NULL DEFAULT 'started', started_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(campaign_id,user_id)
);
CREATE TABLE submissions (
 id UUID PRIMARY KEY, campaign_id BIGINT NOT NULL REFERENCES task_campaigns(id),
 user_id BIGINT NOT NULL REFERENCES users(id), proof_json JSONB NOT NULL, public_consent BOOLEAN NOT NULL DEFAULT false,
 status TEXT NOT NULL CHECK(status IN ('reserving','reservation_failed','in_review','changes_requested','approved','rejected','paid','payout_failed')),
 reviewer_id BIGINT REFERENCES users(id), review_note TEXT, submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_at TIMESTAMPTZ, UNIQUE(campaign_id,user_id)
);
CREATE TABLE payouts (
 id BIGSERIAL PRIMARY KEY, submission_id UUID NOT NULL UNIQUE REFERENCES submissions(id),
 amount_kda NUMERIC(18,6) NOT NULL, recipient TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','confirmed','failed')),
 request_key TEXT, error TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
 paid_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE chain_jobs (
 id UUID PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
 campaign_id BIGINT REFERENCES task_campaigns(id), submission_id UUID REFERENCES submissions(id),
 payout_id BIGINT REFERENCES payouts(id), actor_id BIGINT REFERENCES users(id),
 command JSONB NOT NULL, request_key TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','broadcast','confirmed','failed')),
 result JSONB, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), confirmed_at TIMESTAMPTZ
);
CREATE TABLE work_items (
 id BIGSERIAL PRIMARY KEY, submission_id UUID NOT NULL UNIQUE REFERENCES submissions(id),
 finding_text TEXT NOT NULL, public_links JSONB NOT NULL, published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE campaign_ledger (
 id BIGSERIAL PRIMARY KEY, campaign_id BIGINT NOT NULL REFERENCES task_campaigns(id),
 event_type TEXT NOT NULL, amount_kda NUMERIC(18,6) NOT NULL, tx TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(campaign_id,event_type,tx)
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value JSONB NOT NULL);
INSERT INTO settings VALUES ('payouts_paused','false');
CREATE TABLE idempotency_keys (
 actor_id BIGINT NOT NULL REFERENCES users(id), key TEXT NOT NULL, fingerprint TEXT NOT NULL,
 response JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,key)
);
CREATE TABLE audit_log (
 id BIGSERIAL PRIMARY KEY, actor_id BIGINT REFERENCES users(id), action TEXT NOT NULL,
 entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON submissions(status);
CREATE INDEX ON payouts(status);
CREATE INDEX ON chain_jobs(status);
CREATE INDEX ON task_campaigns(status);
CREATE INDEX ON sessions(expires_at);
CREATE INDEX ON audit_log(created_at);
