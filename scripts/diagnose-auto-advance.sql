-- ============================================================================
-- DIAGNOSTIC QUERIES: Auto-Advance Timer Bug
-- Run these in the Supabase SQL Editor to investigate the issue
-- ============================================================================

-- ============================================================================
-- QUERY 1: Find all slots in "voting" status with 0 active clips
-- This is the bug condition
-- ============================================================================
SELECT
    s.label as season_name,
    s.genre,
    s.status as season_status,
    ss.slot_position,
    ss.status as slot_status,
    ss.voting_started_at,
    ss.voting_ends_at,
    ss.voting_duration_hours,
    CASE
        WHEN ss.voting_ends_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (ss.voting_ends_at - NOW())) / 3600
        ELSE NULL
    END as hours_remaining,
    (
        SELECT COUNT(*)
        FROM tournament_clips tc
        WHERE tc.season_id = ss.season_id
          AND tc.slot_position = ss.slot_position
          AND tc.status = 'active'
    ) as active_clip_count
FROM story_slots ss
JOIN seasons s ON s.id = ss.season_id
WHERE ss.status = 'voting'
ORDER BY s.label, ss.slot_position;

-- ============================================================================
-- QUERY 2: Find the BUGGY slots (voting with 0 clips)
-- ============================================================================
WITH slot_clip_counts AS (
    SELECT
        ss.id,
        ss.season_id,
        ss.slot_position,
        ss.status,
        ss.voting_started_at,
        ss.voting_ends_at,
        COUNT(tc.id) FILTER (WHERE tc.status = 'active') as active_clips
    FROM story_slots ss
    LEFT JOIN tournament_clips tc
        ON tc.season_id = ss.season_id
        AND tc.slot_position = ss.slot_position
    WHERE ss.status = 'voting'
    GROUP BY ss.id, ss.season_id, ss.slot_position, ss.status, ss.voting_started_at, ss.voting_ends_at
)
SELECT
    s.label as season_name,
    s.genre,
    scc.slot_position,
    scc.status,
    scc.active_clips,
    scc.voting_started_at,
    scc.voting_ends_at,
    '⚠️ BUG: Voting with 0 clips!' as issue
FROM slot_clip_counts scc
JOIN seasons s ON s.id = scc.season_id
WHERE scc.active_clips = 0;

-- ============================================================================
-- QUERY 3: Check what happened to clips in the buggy slots
-- (Were they deleted/rejected after voting started?)
-- ============================================================================
SELECT
    s.label as season_name,
    tc.slot_position,
    tc.title,
    tc.status as clip_status,
    tc.created_at,
    tc.updated_at,
    ss.voting_started_at,
    CASE
        WHEN tc.updated_at > ss.voting_started_at THEN 'Changed AFTER voting started'
        ELSE 'Changed BEFORE voting started'
    END as timing
FROM tournament_clips tc
JOIN story_slots ss
    ON ss.season_id = tc.season_id
    AND ss.slot_position = tc.slot_position
JOIN seasons s ON s.id = tc.season_id
WHERE ss.status = 'voting'
  AND tc.status IN ('rejected', 'pending')  -- Not 'active'
ORDER BY s.label, tc.slot_position, tc.updated_at DESC;

-- ============================================================================
-- QUERY 4: Check cron lock status
-- ============================================================================
SELECT
    job_name,
    lock_id,
    created_at,
    expires_at,
    CASE
        WHEN expires_at < NOW() THEN '❌ EXPIRED'
        ELSE '🔒 ACTIVE'
    END as lock_status,
    EXTRACT(EPOCH FROM (expires_at - NOW())) as seconds_until_expiry
FROM cron_locks
ORDER BY created_at DESC;

-- ============================================================================
-- QUERY 5: Recent clip status changes (last 24 hours)
-- ============================================================================
SELECT
    s.label as season_name,
    tc.slot_position,
    tc.title,
    tc.status,
    tc.created_at,
    tc.updated_at
FROM tournament_clips tc
JOIN seasons s ON s.id = tc.season_id
WHERE tc.updated_at > NOW() - INTERVAL '24 hours'
ORDER BY tc.updated_at DESC
LIMIT 50;

-- ============================================================================
-- QUERY 6: Expired voting timers that weren't processed
-- ============================================================================
SELECT
    s.label as season_name,
    s.genre,
    ss.slot_position,
    ss.status,
    ss.voting_ends_at,
    NOW() - ss.voting_ends_at as time_since_expired,
    '⚠️ Timer expired but slot not advanced!' as issue
FROM story_slots ss
JOIN seasons s ON s.id = ss.season_id
WHERE ss.status = 'voting'
  AND ss.voting_ends_at < NOW()
ORDER BY ss.voting_ends_at;

-- ============================================================================
-- FIX QUERY: Set buggy slots to waiting_for_clips
-- UNCOMMENT AND RUN ONLY AFTER REVIEWING THE DIAGNOSTIC QUERIES
-- ============================================================================
/*
-- First, identify the slots to fix
WITH buggy_slots AS (
    SELECT ss.id, ss.season_id, ss.slot_position
    FROM story_slots ss
    WHERE ss.status = 'voting'
      AND NOT EXISTS (
          SELECT 1
          FROM tournament_clips tc
          WHERE tc.season_id = ss.season_id
            AND tc.slot_position = ss.slot_position
            AND tc.status = 'active'
      )
)
UPDATE story_slots
SET
    status = 'waiting_for_clips',
    voting_started_at = NULL,
    voting_ends_at = NULL
WHERE id IN (SELECT id FROM buggy_slots)
RETURNING id, season_id, slot_position, status;
*/

-- ============================================================================
-- CLEAN UP: Remove expired cron locks
-- ============================================================================
/*
DELETE FROM cron_locks
WHERE expires_at < NOW()
RETURNING *;
*/
