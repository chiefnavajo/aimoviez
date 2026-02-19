-- Migration: Add appearance_description to pinned_characters
-- Purpose: Text description of character appearance, used as prompt fallback
-- when reference-to-video is unavailable or as enhancement to any generation mode.

ALTER TABLE pinned_characters
  ADD COLUMN IF NOT EXISTS appearance_description TEXT;

COMMENT ON COLUMN pinned_characters.appearance_description
  IS 'Text description of character appearance, used as prompt fallback when reference-to-video is unavailable';
