/* ============================================================================
   PHASE 3 FEATURE FLAGS
   ============================================================================
   Adds feature flags for Phase 3: Edge Distribution.
   All flags default to disabled (safe to deploy before enabling).
   ============================================================================ */

INSERT INTO feature_flags (key, name, description, category, enabled, config)
VALUES
  ('r2_storage', 'Cloudflare R2 Storage', 'Use Cloudflare R2 for video uploads instead of Supabase Storage', 'performance', false, '{}'),
  ('vote_count_cache', 'Vote Count Cache', 'Redis cache for vote counts to reduce DB reads (15s TTL)', 'performance', false, '{"ttlSeconds": 15}')
ON CONFLICT (key) DO NOTHING;
