-- ============================================================================
-- ADD ASYNC VOTING FEATURE FLAG
-- Enables toggling between synchronous and asynchronous vote processing
-- Phase 0: Starts DISABLED. Phase 1 enables it when the async pipeline is ready.
-- Run this in Supabase SQL Editor
-- ============================================================================

INSERT INTO feature_flags (key, name, description, category, enabled, config)
VALUES (
  'async_voting',
  'Async Vote Processing',
  'Toggle sync/async vote processing path. When enabled, votes are queued in Redis and batch-synced to PostgreSQL. Requires Redis and the counter sync worker.',
  'performance',
  FALSE,
  '{"batchSize": 100, "syncIntervalMs": 30000, "maxRetries": 5, "deadLetterOverflowThreshold": 1000}'::JSONB
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  config = EXCLUDED.config;

-- Verify the flag was added
SELECT key, name, enabled, category, config FROM feature_flags WHERE key = 'async_voting';
