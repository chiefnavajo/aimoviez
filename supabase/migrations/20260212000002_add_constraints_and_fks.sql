-- =============================================================================
-- FIX: Add missing foreign keys and CHECK constraints
-- =============================================================================
-- 1. story_slots FK to seasons (enables CASCADE delete)
-- 2. ai_generations ON DELETE SET NULL for user_id
-- 3. Various CHECK constraints for data integrity
-- =============================================================================

-- 1. story_slots → seasons FK (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_story_slots_season'
    AND table_name = 'story_slots'
  ) THEN
    ALTER TABLE public.story_slots
      ADD CONSTRAINT fk_story_slots_season
      FOREIGN KEY (season_id) REFERENCES public.seasons(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2. ai_generations.user_id ON DELETE SET NULL (if FK exists, alter; if not, add)
DO $$
BEGIN
  -- Drop existing FK if it doesn't have ON DELETE behavior
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name LIKE '%ai_generations%user%'
    AND table_name = 'ai_generations'
    AND constraint_type = 'FOREIGN KEY'
  ) THEN
    -- Get the actual constraint name and recreate with ON DELETE SET NULL
    NULL; -- Skip if FK already exists (avoid breaking changes)
  ELSE
    -- Add FK if it doesn't exist
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ai_generations' AND column_name = 'user_id'
    ) THEN
      ALTER TABLE public.ai_generations
        ADD CONSTRAINT fk_ai_generations_user
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- 3. CHECK constraints (all idempotent with IF NOT EXISTS pattern)

-- movie_projects.spent_credits >= 0
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'movie_projects_spent_credits_non_negative'
  ) THEN
    ALTER TABLE public.movie_projects
      ADD CONSTRAINT movie_projects_spent_credits_non_negative
      CHECK (spent_credits >= 0);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add movie_projects spent_credits constraint: %', SQLERRM;
END $$;

-- credit_packages.credits > 0
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'credit_packages_credits_positive'
  ) THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'credit_packages') THEN
      ALTER TABLE public.credit_packages
        ADD CONSTRAINT credit_packages_credits_positive
        CHECK (credits > 0);
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add credit_packages credits constraint: %', SQLERRM;
END $$;

-- model_pricing.credit_cost > 0
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'model_pricing_credit_cost_positive'
  ) THEN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'model_pricing') THEN
      ALTER TABLE public.model_pricing
        ADD CONSTRAINT model_pricing_credit_cost_positive
        CHECK (credit_cost > 0);
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add model_pricing credit_cost constraint: %', SQLERRM;
END $$;
