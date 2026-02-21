-- Migration: Prevent double refunds with unique partial index
-- Date: 2026-02-21
-- Purpose: Ensures only one refund can exist per reference_id (generation_id)
-- This prevents TOCTOU race conditions where concurrent cancel + webhook
-- could both issue refunds for the same generation.

-- Unique partial index: only one refund per reference_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_trans_unique_refund
  ON credit_transactions (reference_id)
  WHERE type = 'refund' AND reference_id IS NOT NULL;
