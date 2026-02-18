-- =============================================================================
-- FIX: Version-control cron_locks table + add idempotency indexes
-- =============================================================================
-- 1. cron_locks table was created manually in production but never migrated.
--    This ensures fresh deployments get the table + UNIQUE constraint.
-- 2. Partial unique indexes prevent double-refund and double-credit exploits
--    caused by TOCTOU race conditions in refund_credits and add_credits.
-- =============================================================================

-- 1. cron_locks table (idempotent — IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS public.cron_locks (
    job_name text NOT NULL,
    lock_id text NOT NULL,
    expires_at timestamptz NOT NULL,
    acquired_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure UNIQUE constraint exists (prevents concurrent cron execution)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cron_locks_job_name_key' AND conrelid = 'public.cron_locks'::regclass
  ) THEN
    ALTER TABLE public.cron_locks ADD CONSTRAINT cron_locks_job_name_key UNIQUE (job_name);
  END IF;
END $$;

-- 2. Prevent double-refund: only one refund per generation
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_refund_unique
  ON public.credit_transactions (reference_id)
  WHERE type = 'refund' AND reference_id IS NOT NULL;

-- 3. Prevent double Stripe payment processing
-- Drop the existing non-unique index first if it exists, then create unique version
DO $$
BEGIN
  -- Check if a non-unique index exists and drop it
  IF EXISTS (
    SELECT 1 FROM pg_indexes i
    JOIN pg_index pi ON pi.indexrelid = (quote_ident(i.schemaname) || '.' || quote_ident(i.indexname))::regclass
    WHERE i.indexname = 'idx_credit_trans_stripe'
    AND NOT pi.indisunique
  ) THEN
    DROP INDEX IF EXISTS public.idx_credit_trans_stripe;
  END IF;
EXCEPTION WHEN undefined_object THEN
  -- Index doesn't exist at all, nothing to drop
  NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_trans_stripe_unique
  ON public.credit_transactions (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
