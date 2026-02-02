-- ============================================================================
-- ELEVENLABS NARRATION MIGRATION
-- Adds narration support to AI video generation pipeline.
-- ============================================================================

-- 1. Narration columns on ai_generations
ALTER TABLE ai_generations
  ADD COLUMN IF NOT EXISTS narration_text VARCHAR(300),
  ADD COLUMN IF NOT EXISTS narration_voice_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS narration_cost_cents INTEGER DEFAULT 0;

-- 2. Track narration on tournament clips
ALTER TABLE tournament_clips
  ADD COLUMN IF NOT EXISTS has_narration BOOLEAN DEFAULT FALSE;

-- 3. Feature flag with voice list + config (disabled by default)
INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('elevenlabs_narration', 'AI Narration (ElevenLabs TTS)',
   'Add AI voiceover narration to video clips',
   'creation', false,
   '{
     "max_chars": 200,
     "cost_per_generation_cents": 5,
     "daily_limit": 10,
     "model": "eleven_flash_v2_5",
     "output_format": "mp3_44100_128",
     "voices": [
       {"id": "21m00Tcm4TlvDq8ikWAM", "name": "Rachel", "accent": "American", "gender": "female", "style": "calm"},
       {"id": "EXAVITQu4vr4xnSDxMaL", "name": "Bella", "accent": "American", "gender": "female", "style": "soft"},
       {"id": "ErXwobaYiN019PkySvjV", "name": "Antoni", "accent": "American", "gender": "male", "style": "warm"},
       {"id": "TxGEqnHWrfWFTfGW9XjX", "name": "Josh", "accent": "American", "gender": "male", "style": "deep"},
       {"id": "VR6AewLTigWG4xSOukaG", "name": "Arnold", "accent": "American", "gender": "male", "style": "crisp"},
       {"id": "pNInz6obpgDQGcFmaJgB", "name": "Adam", "accent": "American", "gender": "male", "style": "deep"}
     ],
     "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "speed": 1.0}
   }'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 4. Update global cost cap function to include narration costs
CREATE OR REPLACE FUNCTION check_global_cost_cap(
  p_daily_limit_cents INTEGER,
  p_monthly_limit_cents INTEGER,
  p_new_cost_cents INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  v_daily_total INTEGER;
  v_monthly_total INTEGER;
BEGIN
  SELECT COALESCE(SUM(cost_cents + COALESCE(narration_cost_cents, 0)), 0) INTO v_daily_total
  FROM ai_generations
  WHERE created_at >= CURRENT_DATE
    AND status != 'failed';

  SELECT COALESCE(SUM(cost_cents + COALESCE(narration_cost_cents, 0)), 0) INTO v_monthly_total
  FROM ai_generations
  WHERE created_at >= date_trunc('month', CURRENT_DATE)
    AND status != 'failed';

  RETURN (v_daily_total + p_new_cost_cents <= p_daily_limit_cents)
     AND (v_monthly_total + p_new_cost_cents <= p_monthly_limit_cents);
END;
$$ LANGUAGE plpgsql;
