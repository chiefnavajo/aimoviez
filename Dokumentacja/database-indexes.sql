-- ============================================================================
-- DATABASE PERFORMANCE INDEXES
-- Run this in Supabase SQL Editor to improve query performance
-- Created: 2024-12-30
-- ============================================================================

-- ============================================================================
-- VOTES TABLE INDEXES
-- Most critical for voting performance
-- ============================================================================

-- Index for checking if user has voted (most frequent query)
CREATE INDEX IF NOT EXISTS idx_votes_voter_key
  ON votes(voter_key);

-- Composite index for checking votes in a specific slot
CREATE INDEX IF NOT EXISTS idx_votes_voter_slot
  ON votes(voter_key, slot_position);

-- Composite index for checking specific vote on a clip
CREATE INDEX IF NOT EXISTS idx_votes_voter_clip
  ON votes(voter_key, clip_id);

-- Index for counting votes per clip
CREATE INDEX IF NOT EXISTS idx_votes_clip_id
  ON votes(clip_id);

-- Index for daily vote tracking
CREATE INDEX IF NOT EXISTS idx_votes_created_at
  ON votes(created_at DESC);

-- ============================================================================
-- TOURNAMENT_CLIPS TABLE INDEXES
-- Critical for clip queries and voting
-- ============================================================================

-- Main composite index for fetching clips in a slot
CREATE INDEX IF NOT EXISTS idx_clips_slot_season_status
  ON tournament_clips(slot_position, season_id, status);

-- Index for clip status filtering
CREATE INDEX IF NOT EXISTS idx_clips_status
  ON tournament_clips(status);

-- Index for user's clips (profile page)
CREATE INDEX IF NOT EXISTS idx_clips_user_id
  ON tournament_clips(user_id);

-- Index for season-based queries
CREATE INDEX IF NOT EXISTS idx_clips_season_id
  ON tournament_clips(season_id);

-- Index for leaderboard queries (vote count ordering)
CREATE INDEX IF NOT EXISTS idx_clips_vote_count
  ON tournament_clips(vote_count DESC);

-- Index for weighted score ordering
CREATE INDEX IF NOT EXISTS idx_clips_weighted_score
  ON tournament_clips(weighted_score DESC);

-- Composite index for fetching active clips by slot (most common query)
CREATE INDEX IF NOT EXISTS idx_clips_slot_status_score
  ON tournament_clips(slot_position, status, weighted_score DESC);

-- ============================================================================
-- STORY_SLOTS TABLE INDEXES
-- Critical for story page and voting slot lookup
-- ============================================================================

-- Composite index for finding active/voting slots in a season
CREATE INDEX IF NOT EXISTS idx_slots_season_status
  ON story_slots(season_id, status);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_slots_status
  ON story_slots(status);

-- Index for slot position ordering
CREATE INDEX IF NOT EXISTS idx_slots_position
  ON story_slots(slot_position);

-- Index for finding expired voting slots (cron job)
CREATE INDEX IF NOT EXISTS idx_slots_voting_ends
  ON story_slots(voting_ends_at)
  WHERE status = 'voting';

-- ============================================================================
-- SEASONS TABLE INDEXES
-- ============================================================================

-- Index for finding active/finished seasons
CREATE INDEX IF NOT EXISTS idx_seasons_status
  ON seasons(status);

-- Index for ordering by creation date
CREATE INDEX IF NOT EXISTS idx_seasons_created
  ON seasons(created_at DESC);

-- ============================================================================
-- COMMENTS TABLE INDEXES
-- ============================================================================

-- Index for fetching comments on a clip
CREATE INDEX IF NOT EXISTS idx_comments_clip_id
  ON comments(clip_id);

-- Index for user's comments
CREATE INDEX IF NOT EXISTS idx_comments_user_id
  ON comments(user_id);

-- Composite for fetching non-deleted comments on a clip
CREATE INDEX IF NOT EXISTS idx_comments_clip_active
  ON comments(clip_id, is_deleted)
  WHERE is_deleted = false;

-- ============================================================================
-- USERS TABLE INDEXES (if exists)
-- ============================================================================

-- Index for email lookup (authentication)
CREATE INDEX IF NOT EXISTS idx_users_email
  ON users(email);

-- Index for username lookup
CREATE INDEX IF NOT EXISTS idx_users_username
  ON users(username);

-- ============================================================================
-- CLIP_VIEWS TABLE INDEXES (if exists)
-- ============================================================================

-- Composite for tracking unique views
CREATE INDEX IF NOT EXISTS idx_clip_views_viewer_clip
  ON clip_views(viewer_key, clip_id);

-- ============================================================================
-- VERIFICATION QUERY
-- Run this after creating indexes to verify they exist
-- ============================================================================

-- SELECT
--   schemaname,
--   tablename,
--   indexname,
--   indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
-- ORDER BY tablename, indexname;

-- ============================================================================
-- ANALYZE TABLES (Run after creating indexes)
-- This updates statistics for the query planner
-- ============================================================================

ANALYZE votes;
ANALYZE tournament_clips;
ANALYZE story_slots;
ANALYZE seasons;
ANALYZE comments;
