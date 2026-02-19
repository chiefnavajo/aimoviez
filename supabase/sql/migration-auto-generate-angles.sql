-- =============================================================================
-- MIGRATION: Auto-Generate Character Angles (Feature Flag Only)
-- Enables automatic generation of left/right/rear reference angles from
-- a single frontal photo using Kling O1 Image.
-- =============================================================================

INSERT INTO feature_flags (key, name, description, category, enabled)
VALUES (
  'auto_generate_angles',
  'Auto-Generate Character Angles',
  'Automatically generate left/right/rear reference angles from frontal photo using Kling O1 Image (~9c per character)',
  'ai',
  false
)
ON CONFLICT (key) DO NOTHING;
