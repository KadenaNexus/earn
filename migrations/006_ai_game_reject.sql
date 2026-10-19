-- The AI agent may reject a game win whose written answer misses the key idea.
ALTER TABLE ai_reviews DROP CONSTRAINT IF EXISTS ai_reviews_decision_check;
ALTER TABLE ai_reviews ADD CONSTRAINT ai_reviews_decision_check CHECK(decision IN ('approve','request_changes','escalate','reject','error'));
ALTER TABLE ai_reviews DROP CONSTRAINT IF EXISTS ai_reviews_applied_check;
ALTER TABLE ai_reviews ADD CONSTRAINT ai_reviews_applied_check CHECK(applied IN ('pending','approved','changes_requested','rejected','escalated','skipped'));
