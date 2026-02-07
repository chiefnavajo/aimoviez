-- Migration: Fix overly permissive RLS on direction_votes
-- This restricts direct inserts to service_role only, requiring all votes to go through the API

-- Drop the overly permissive INSERT policy
DROP POLICY IF EXISTS "direction_votes_insert_any" ON direction_votes;

-- Create restrictive INSERT policy (service_role only)
-- This ensures all votes must go through the API which validates voting is open, etc.
CREATE POLICY "direction_votes_insert_service" ON direction_votes
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Note: The select_all policy remains unchanged so anyone can read votes
-- Note: The delete_service policy remains unchanged so only service_role can delete
