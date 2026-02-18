-- Migration: Add spotlight_tour feature flag
-- This enables the new CSS box-shadow spotlight onboarding tour
-- Run this in Supabase SQL Editor

INSERT INTO feature_flags (key, name, description, enabled, category)
VALUES (
  'spotlight_tour',
  'Spotlight Onboarding Tour',
  'New spotlight-based onboarding tour with CSS box-shadow overlay. When disabled, falls back to modal tour.',
  false,
  'engagement'
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

-- Verify the flag was added
SELECT key, name, enabled, category FROM feature_flags WHERE key = 'spotlight_tour';
