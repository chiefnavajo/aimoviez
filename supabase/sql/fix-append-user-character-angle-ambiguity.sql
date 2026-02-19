-- =============================================================================
-- FIX: "column reference_image_urls is ambiguous" in append_user_character_angle
-- The RETURNS TABLE column name conflicted with the table column name.
-- Fix: rename return columns to out_* and fully qualify all column references.
-- Must DROP first because return type changed (PostgreSQL requirement).
-- =============================================================================

DROP FUNCTION IF EXISTS append_user_character_angle(uuid,uuid,text,integer);

CREATE OR REPLACE FUNCTION append_user_character_angle(
  p_id UUID,
  p_user_id UUID,
  p_url TEXT,
  p_max_refs INTEGER DEFAULT 6
)
RETURNS TABLE(out_id UUID, out_reference_image_urls TEXT[]) AS $$
BEGIN
  RETURN QUERY
  UPDATE user_characters uc
  SET
    reference_image_urls = array_append(uc.reference_image_urls, p_url),
    updated_at = NOW()
  WHERE uc.id = p_id
    AND uc.user_id = p_user_id
    AND uc.is_active = true
    AND (array_length(uc.reference_image_urls, 1) IS NULL OR array_length(uc.reference_image_urls, 1) < p_max_refs)
  RETURNING uc.id, uc.reference_image_urls;
END;
$$ LANGUAGE plpgsql;

-- Re-grant after drop
GRANT EXECUTE ON FUNCTION append_user_character_angle TO service_role;
