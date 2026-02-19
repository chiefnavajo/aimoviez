-- =============================================================================
-- MIGRATION: Remove/Clear individual user character reference angles
-- Adds RPCs for angle management (delete individual, clear all for regeneration)
-- =============================================================================

-- 1. Remove a specific reference angle URL from a user character
-- Uses array_remove() for atomic removal with ownership check
CREATE OR REPLACE FUNCTION remove_user_character_angle(
  p_id UUID,
  p_user_id UUID,
  p_url TEXT
)
RETURNS TABLE(out_id UUID, out_reference_image_urls TEXT[]) AS $$
BEGIN
  RETURN QUERY
  UPDATE user_characters uc
  SET
    reference_image_urls = array_remove(uc.reference_image_urls, p_url),
    updated_at = NOW()
  WHERE uc.id = p_id
    AND uc.user_id = p_user_id
    AND uc.is_active = true
    AND p_url = ANY(uc.reference_image_urls)
  RETURNING uc.id, uc.reference_image_urls;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION remove_user_character_angle TO service_role;

-- 2. Clear all reference angles from a user character (for "Regenerate All")
-- Resets reference_image_urls to empty array
CREATE OR REPLACE FUNCTION clear_user_character_angles(
  p_id UUID,
  p_user_id UUID
)
RETURNS TABLE(out_id UUID, out_reference_image_urls TEXT[]) AS $$
BEGIN
  RETURN QUERY
  UPDATE user_characters uc
  SET
    reference_image_urls = '{}',
    updated_at = NOW()
  WHERE uc.id = p_id
    AND uc.user_id = p_user_id
    AND uc.is_active = true
  RETURNING uc.id, uc.reference_image_urls;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION clear_user_character_angles TO service_role;
