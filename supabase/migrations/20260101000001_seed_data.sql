-- Seed data: feature flags and credit packages needed for integration tests
-- These match the production configuration

INSERT INTO feature_flags (key, name, description, enabled, category) VALUES
  ('async_voting', 'Async Voting', 'Process votes asynchronously via Redis queue', true, 'voting'),
  ('credit_system', 'Credit System', 'Enable credit-based AI generation', true, 'monetization'),
  ('multi_vote_mode', 'Multi Vote Mode', 'Allow users to vote multiple times per clip', false, 'voting'),
  ('ai_movie_generation', 'AI Movie Generation', 'Enable AI movie generation feature', false, 'ai'),
  ('co_director', 'AI Co-Director', 'Enable AI co-director direction voting', false, 'ai'),
  ('prompt_learning', 'Prompt Learning', 'Enable prompt learning from vote outcomes', false, 'ai'),
  ('visual_learning', 'Visual Learning', 'Enable visual learning from clip thumbnails', false, 'ai'),
  ('teams', 'Teams', 'Enable team features', true, 'social'),
  ('comments', 'Comments', 'Enable comment system', true, 'social'),
  ('leaderboard', 'Leaderboard', 'Enable leaderboard features', true, 'social')
ON CONFLICT (key) DO NOTHING;

INSERT INTO credit_packages (name, credits, price_cents, bonus_percent, is_active, sort_order) VALUES
  ('Starter', 50, 499, 0, true, 1),
  ('Popular', 150, 999, 10, true, 2),
  ('Pro', 500, 2999, 20, true, 3),
  ('Studio', 1500, 7999, 30, true, 4)
ON CONFLICT DO NOTHING;

INSERT INTO model_pricing (model_key, display_name, fal_cost_cents, credit_cost, is_active) VALUES
  ('kling-2.0', 'Kling 2.0', 10, 10, true),
  ('kling-2.6', 'Kling 2.6', 15, 15, true),
  ('minimax-video-01', 'MiniMax Video', 12, 12, true),
  ('wan-2.1', 'Wan 2.1', 8, 8, true)
ON CONFLICT (model_key) DO NOTHING;
