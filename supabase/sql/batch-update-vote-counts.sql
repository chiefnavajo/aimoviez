/* BATCH UPDATE VOTE COUNTS
   Atomically updates vote_count and weighted_score for multiple clips.
   Used by the counter sync worker (Phase 1) to flush Redis counters to PostgreSQL.
   Sets ABSOLUTE values (idempotent), does NOT increment.
   Run this in Supabase SQL Editor. */

ALTER TABLE tournament_clips ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE OR REPLACE FUNCTION batch_update_vote_counts(
  p_updates JSONB
)
RETURNS JSONB
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_item JSONB;
  v_clip_id UUID;
  v_vote_count INTEGER;
  v_weighted_score INTEGER;
  v_updated_count INTEGER := 0;
  v_errors JSONB := '[]'::JSONB;
  v_error_text TEXT;
BEGIN
  -- Validate input is an array
  IF jsonb_typeof(p_updates) != 'array' THEN
    RETURN jsonb_build_object(
      'updated_count', 0,
      'errors', jsonb_build_array(
        jsonb_build_object('clip_id', NULL, 'error', 'p_updates must be a JSON array')
      )
    );
  END IF;

  -- Process each update item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    BEGIN
      -- Extract and validate fields
      v_clip_id := (v_item ->> 'clip_id')::UUID;
      v_vote_count := (v_item ->> 'vote_count')::INTEGER;
      v_weighted_score := (v_item ->> 'weighted_score')::INTEGER;

      -- SET absolute values (idempotent) with updated_at timestamp
      UPDATE tournament_clips
      SET
        vote_count = v_vote_count,
        weighted_score = v_weighted_score,
        updated_at = NOW()
      WHERE id = v_clip_id;

      -- Check if the row was actually found and updated
      IF FOUND THEN
        v_updated_count := v_updated_count + 1;
      ELSE
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object(
            'clip_id', v_item ->> 'clip_id',
            'error', 'Clip not found'
          )
        );
      END IF;

    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error_text = MESSAGE_TEXT;
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object(
            'clip_id', v_item ->> 'clip_id',
            'error', v_error_text
          )
        );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'updated_count', v_updated_count,
    'errors', v_errors
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION batch_update_vote_counts(JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION batch_update_vote_counts(JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

SELECT routine_name, routine_type, data_type
FROM information_schema.routines
WHERE routine_name = 'batch_update_vote_counts';
