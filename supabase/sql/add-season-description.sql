-- Migration: Add description column to seasons table
-- This enables the typewriter story description on the Story page
-- Run this in Supabase SQL Editor

ALTER TABLE seasons ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';

-- Verify the column was added
SELECT id, label, status, description FROM seasons LIMIT 5;
