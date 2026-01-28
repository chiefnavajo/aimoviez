/* ============================================================================
   PHASE 2 FEATURE FLAGS
   ============================================================================
   Adds feature flags for Phase 2: Auth + Real-Time + Comments + Leaderboards.
   All flags default to disabled (safe to deploy before enabling).
   ============================================================================ */

INSERT INTO feature_flags (key, name, description, category, enabled, config)
VALUES
  ('redis_session_store', 'Redis Session Store', 'Fast session lookups via Redis instead of Supabase DB queries', 'performance', false, '{"ttlSeconds": 1800}'),
  ('realtime_broadcast', 'Real-Time Broadcast', 'Supabase Broadcast for live vote and comment updates', 'realtime', false, '{}'),
  ('async_comments', 'Async Comment Processing', 'Queue comment writes to Redis for async DB persistence', 'performance', false, '{"batchSize": 200, "maxRetries": 5}'),
  ('redis_leaderboards', 'Redis Leaderboards', 'Redis Sorted Sets for instant leaderboard queries', 'performance', false, '{"dailyTtlHours": 48}')
ON CONFLICT (key) DO NOTHING;
