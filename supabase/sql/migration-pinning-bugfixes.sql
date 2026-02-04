-- migration-pinning-bugfixes.sql
-- ============================================================================
-- Bug fixes for character pinning
-- ============================================================================

-- Atomic usage_count increment for pinned characters (Bug 1)
CREATE OR REPLACE FUNCTION increment_pinned_usage(p_ids UUID[])
RETURNS void
LANGUAGE sql
AS $$
  UPDATE pinned_characters
  SET usage_count = usage_count + 1
  WHERE id = ANY(p_ids);
$$;

-- Atomic array append for reference angles with length guard (Bug 3)
CREATE OR REPLACE FUNCTION append_reference_angle(
  p_id UUID,
  p_url TEXT,
  p_max_refs INTEGER DEFAULT 6
)
RETURNS TABLE(id UUID, reference_image_urls TEXT[])
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE pinned_characters pc
  SET reference_image_urls = pc.reference_image_urls || p_url
  WHERE pc.id = p_id
    AND coalesce(array_length(pc.reference_image_urls, 1), 0) < p_max_refs
  RETURNING pc.id, pc.reference_image_urls;
END;
$$;
