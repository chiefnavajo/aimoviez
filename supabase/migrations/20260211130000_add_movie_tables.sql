-- =============================================================================
-- AI Movie Generation: 3 new tables + feature flag + RLS + indexes
-- =============================================================================

-- 1. movie_projects: Top-level project entity
CREATE TABLE IF NOT EXISTS "public"."movie_projects" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "title" varchar(200) NOT NULL,
    "description" text,
    "source_text" text NOT NULL,
    "model" varchar(50) NOT NULL DEFAULT 'kling-2.6',
    "style" varchar(50),
    "voice_id" varchar(100),
    "aspect_ratio" varchar(10) DEFAULT '16:9',
    "target_duration_minutes" integer DEFAULT 10 NOT NULL,
    "status" varchar(30) DEFAULT 'draft' NOT NULL,
    "total_scenes" integer DEFAULT 0,
    "completed_scenes" integer DEFAULT 0,
    "current_scene" integer DEFAULT 0,
    "estimated_credits" integer DEFAULT 0,
    "spent_credits" integer DEFAULT 0,
    "final_video_url" text,
    "total_duration_seconds" numeric(8,2),
    "error_message" text,
    "script_data" jsonb,
    "created_at" timestamptz DEFAULT now(),
    "updated_at" timestamptz DEFAULT now(),
    "completed_at" timestamptz,
    CONSTRAINT "movie_projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "movie_projects_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"),
    CONSTRAINT "valid_movie_status" CHECK (
        status IN ('draft', 'script_generating', 'script_ready', 'generating', 'paused', 'completed', 'failed', 'cancelled')
    )
);

ALTER TABLE "public"."movie_projects" OWNER TO "postgres";

-- 2. movie_scenes: Individual scenes within a project
CREATE TABLE IF NOT EXISTS "public"."movie_scenes" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL,
    "scene_number" integer NOT NULL,
    "video_prompt" text NOT NULL,
    "narration_text" text,
    "scene_title" varchar(200),
    "status" varchar(30) DEFAULT 'pending' NOT NULL,
    "ai_generation_id" uuid,
    "video_url" text,
    "public_video_url" text,
    "last_frame_url" text,
    "duration_seconds" numeric(6,2),
    "credit_cost" integer DEFAULT 0,
    "error_message" text,
    "retry_count" integer DEFAULT 0,
    "created_at" timestamptz DEFAULT now(),
    "completed_at" timestamptz,
    CONSTRAINT "movie_scenes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "movie_scenes_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."movie_projects"("id") ON DELETE CASCADE,
    CONSTRAINT "movie_scenes_generation_fk" FOREIGN KEY ("ai_generation_id") REFERENCES "public"."ai_generations"("id"),
    CONSTRAINT "movie_scenes_unique_number" UNIQUE ("project_id", "scene_number"),
    CONSTRAINT "valid_scene_status" CHECK (
        status IN ('pending', 'generating', 'narrating', 'merging', 'completed', 'failed', 'skipped')
    )
);

ALTER TABLE "public"."movie_scenes" OWNER TO "postgres";

-- 3. movie_access: Admin-granted access control
CREATE TABLE IF NOT EXISTS "public"."movie_access" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "granted_by" uuid,
    "max_projects" integer DEFAULT 5,
    "max_scenes_per_project" integer DEFAULT 150,
    "is_active" boolean DEFAULT true,
    "expires_at" timestamptz,
    "created_at" timestamptz DEFAULT now(),
    CONSTRAINT "movie_access_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "movie_access_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id"),
    CONSTRAINT "movie_access_granted_by_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id"),
    CONSTRAINT "movie_access_user_unique" UNIQUE ("user_id")
);

ALTER TABLE "public"."movie_access" OWNER TO "postgres";

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS "idx_movie_projects_user_id" ON "public"."movie_projects" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_movie_projects_status" ON "public"."movie_projects" ("status");
CREATE INDEX IF NOT EXISTS "idx_movie_projects_user_status" ON "public"."movie_projects" ("user_id", "status");

CREATE INDEX IF NOT EXISTS "idx_movie_scenes_project_id" ON "public"."movie_scenes" ("project_id");
CREATE INDEX IF NOT EXISTS "idx_movie_scenes_status" ON "public"."movie_scenes" ("status");
CREATE INDEX IF NOT EXISTS "idx_movie_scenes_project_number" ON "public"."movie_scenes" ("project_id", "scene_number");
CREATE INDEX IF NOT EXISTS "idx_movie_scenes_generation" ON "public"."movie_scenes" ("ai_generation_id") WHERE "ai_generation_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_movie_access_user_id" ON "public"."movie_access" ("user_id");

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE "public"."movie_projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."movie_scenes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."movie_access" ENABLE ROW LEVEL SECURITY;

-- movie_projects: Users can only see/manage their own projects
DO $$ BEGIN
  CREATE POLICY "Users can view own movie projects"
      ON "public"."movie_projects" FOR SELECT
      USING ("user_id" = "auth"."uid"());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can insert own movie projects"
      ON "public"."movie_projects" FOR INSERT
      WITH CHECK ("user_id" = "auth"."uid"());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own movie projects"
      ON "public"."movie_projects" FOR UPDATE
      USING ("user_id" = "auth"."uid"());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can delete own movie projects"
      ON "public"."movie_projects" FOR DELETE
      USING ("user_id" = "auth"."uid"());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- movie_scenes: Users can see/edit scenes for their own projects
DO $$ BEGIN
  CREATE POLICY "Users can view own movie scenes"
      ON "public"."movie_scenes" FOR SELECT
      USING (EXISTS (
          SELECT 1 FROM "public"."movie_projects"
          WHERE "movie_projects"."id" = "movie_scenes"."project_id"
          AND "movie_projects"."user_id" = "auth"."uid"()
      ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Users can update own movie scenes"
      ON "public"."movie_scenes" FOR UPDATE
      USING (EXISTS (
          SELECT 1 FROM "public"."movie_projects"
          WHERE "movie_projects"."id" = "movie_scenes"."project_id"
          AND "movie_projects"."user_id" = "auth"."uid"()
      ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- movie_access: Users can only view their own access record
DO $$ BEGIN
  CREATE POLICY "Users can view own movie access"
      ON "public"."movie_access" FOR SELECT
      USING ("user_id" = "auth"."uid"());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =============================================================================
-- FEATURE FLAG
-- =============================================================================

INSERT INTO "public"."feature_flags" ("key", "name", "description", "enabled", "category")
VALUES ('ai_movie_generation', 'AI Movie Generation', 'Enable private AI full movie generation for granted users', false, 'ai')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- UPDATED_AT TRIGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION "public"."update_movie_projects_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER "movie_projects_updated_at"
      BEFORE UPDATE ON "public"."movie_projects"
      FOR EACH ROW
      EXECUTE FUNCTION "public"."update_movie_projects_updated_at"();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
