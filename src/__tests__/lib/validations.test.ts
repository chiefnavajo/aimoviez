/**
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Imports (no external dependencies to mock - Zod is a pure library)
// ---------------------------------------------------------------------------

import {
  VoteRequestSchema,
  RegisterClipSchema,
  CreateCommentSchema,
  LikeCommentSchema,
  DeleteCommentSchema,
  GenreVoteSchema,
  ApproveClipSchema,
  RejectClipSchema,
  UpdateClipSchema,
  CreateSeasonSchema,
  UpdateSlotSchema,
  BatchModerationSchema,
  AIGenerateSchema,
  AIRegisterSchema,
  AINarrateSchema,
  DirectionVoteSchema,
  GenerateDirectionsSchema,
  AnalyzeStorySchema,
  OpenDirectionVoteSchema,
  CloseDirectionVoteSchema,
  GenerateBriefSchema,
  PublishBriefSchema,
  MovieScriptPreviewSchema,
  MovieProjectCreateSchema,
  MovieSceneUpdateSchema,
  MovieAccessGrantSchema,
  SuggestClipFrameSchema,
  ReviewSuggestionSchema,
  parseBody,
  ALLOWED_GENRES,
  AI_MODELS,
  AI_STYLES,
} from '@/lib/validations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // VoteRequestSchema
  // =========================================================================
  describe('VoteRequestSchema', () => {
    it('accepts valid UUID clipId', () => {
      const result = VoteRequestSchema.safeParse({ clipId: VALID_UUID });
      expect(result.success).toBe(true);
    });

    it('rejects non-UUID clipId', () => {
      const result = VoteRequestSchema.safeParse({ clipId: 'not-a-uuid' });
      expect(result.success).toBe(false);
    });

    it('rejects missing clipId', () => {
      const result = VoteRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // RegisterClipSchema
  // =========================================================================
  describe('RegisterClipSchema', () => {
    const validData = {
      videoUrl: 'https://cdn.aimoviez.app/video.mp4',
      genre: 'Comedy',
      title: 'My Clip',
      duration: 5,
    };

    it('accepts valid registration data', () => {
      const result = RegisterClipSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('transforms genre to lowercase', () => {
      const result = RegisterClipSchema.safeParse(validData);
      if (result.success) {
        expect(result.data.genre).toBe('comedy');
      }
    });

    it('trims title whitespace', () => {
      const result = RegisterClipSchema.safeParse({
        ...validData,
        title: '  My Clip  ',
      });
      if (result.success) {
        expect(result.data.title).toBe('My Clip');
      }
    });

    it('rejects disallowed video URL hosts', () => {
      const result = RegisterClipSchema.safeParse({
        ...validData,
        videoUrl: 'https://evil.com/video.mp4',
      });
      expect(result.success).toBe(false);
    });

    it('rejects HTTP URLs', () => {
      const result = RegisterClipSchema.safeParse({
        ...validData,
        videoUrl: 'http://cdn.aimoviez.app/video.mp4',
      });
      expect(result.success).toBe(false);
    });

    it('allows supabase.co hosts', () => {
      const result = RegisterClipSchema.safeParse({
        ...validData,
        videoUrl: 'https://my-project.supabase.co/storage/video.mp4',
      });
      expect(result.success).toBe(true);
    });

    it('allows r2.dev hosts', () => {
      const result = RegisterClipSchema.safeParse({
        ...validData,
        videoUrl: 'https://my-bucket.r2.dev/video.mp4',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid genre', () => {
      const result = RegisterClipSchema.safeParse({
        ...validData,
        genre: 'western',
      });
      expect(result.success).toBe(false);
    });

    it('rejects title longer than 100 characters', () => {
      const result = RegisterClipSchema.safeParse({
        ...validData,
        title: 'a'.repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty title', () => {
      const result = RegisterClipSchema.safeParse({
        ...validData,
        title: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects duration over 8.5 seconds', () => {
      const result = RegisterClipSchema.safeParse({
        ...validData,
        duration: 9,
      });
      expect(result.success).toBe(false);
    });

    it('rejects zero/negative duration', () => {
      const result = RegisterClipSchema.safeParse({
        ...validData,
        duration: 0,
      });
      expect(result.success).toBe(false);
    });

    it('makes description optional and defaults to empty string', () => {
      const result = RegisterClipSchema.safeParse(validData);
      if (result.success) {
        expect(result.data.description).toBe('');
      }
    });

    it('rejects description longer than 500 characters', () => {
      const result = RegisterClipSchema.safeParse({
        ...validData,
        description: 'a'.repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // CreateCommentSchema
  // =========================================================================
  describe('CreateCommentSchema', () => {
    it('accepts valid comment data', () => {
      const result = CreateCommentSchema.safeParse({
        clipId: VALID_UUID,
        comment_text: 'Great clip!',
      });
      expect(result.success).toBe(true);
    });

    it('trims comment text', () => {
      const result = CreateCommentSchema.safeParse({
        clipId: VALID_UUID,
        comment_text: '  Hello  ',
      });
      if (result.success) {
        expect(result.data.comment_text).toBe('Hello');
      }
    });

    it('rejects empty comment after trimming', () => {
      const result = CreateCommentSchema.safeParse({
        clipId: VALID_UUID,
        comment_text: '   ',
      });
      expect(result.success).toBe(false);
    });

    it('rejects comment longer than 500 characters', () => {
      const result = CreateCommentSchema.safeParse({
        clipId: VALID_UUID,
        comment_text: 'a'.repeat(501),
      });
      expect(result.success).toBe(false);
    });

    it('allows optional parent_comment_id', () => {
      const result = CreateCommentSchema.safeParse({
        clipId: VALID_UUID,
        comment_text: 'Reply',
        parent_comment_id: VALID_UUID,
      });
      expect(result.success).toBe(true);
    });

    it('allows null parent_comment_id', () => {
      const result = CreateCommentSchema.safeParse({
        clipId: VALID_UUID,
        comment_text: 'Top level',
        parent_comment_id: null,
      });
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // LikeCommentSchema
  // =========================================================================
  describe('LikeCommentSchema', () => {
    it('accepts like action', () => {
      const result = LikeCommentSchema.safeParse({
        comment_id: VALID_UUID,
        action: 'like',
      });
      expect(result.success).toBe(true);
    });

    it('accepts unlike action', () => {
      const result = LikeCommentSchema.safeParse({
        comment_id: VALID_UUID,
        action: 'unlike',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid action', () => {
      const result = LikeCommentSchema.safeParse({
        comment_id: VALID_UUID,
        action: 'dislike',
      });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // DeleteCommentSchema
  // =========================================================================
  describe('DeleteCommentSchema', () => {
    it('accepts valid UUID comment_id', () => {
      const result = DeleteCommentSchema.safeParse({ comment_id: VALID_UUID });
      expect(result.success).toBe(true);
    });

    it('rejects invalid comment_id', () => {
      const result = DeleteCommentSchema.safeParse({ comment_id: 'bad' });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // GenreVoteSchema
  // =========================================================================
  describe('GenreVoteSchema', () => {
    it('accepts all valid votable genres', () => {
      const genres = ['Thriller', 'Comedy', 'Action', 'Sci-Fi', 'Romance', 'Animation', 'Horror', 'Drama'];
      for (const genre of genres) {
        const result = GenreVoteSchema.safeParse({ genre });
        expect(result.success).toBe(true);
      }
    });

    it('rejects lowercase genre (case-sensitive)', () => {
      const result = GenreVoteSchema.safeParse({ genre: 'comedy' });
      expect(result.success).toBe(false);
    });

    it('rejects invalid genre', () => {
      const result = GenreVoteSchema.safeParse({ genre: 'Western' });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // Admin schemas
  // =========================================================================
  describe('ApproveClipSchema', () => {
    it('accepts valid UUID', () => {
      expect(ApproveClipSchema.safeParse({ clipId: VALID_UUID }).success).toBe(true);
    });
  });

  describe('RejectClipSchema', () => {
    it('accepts clipId with optional reason', () => {
      expect(
        RejectClipSchema.safeParse({ clipId: VALID_UUID, reason: 'Inappropriate' }).success
      ).toBe(true);
    });

    it('rejects reason longer than 500 characters', () => {
      expect(
        RejectClipSchema.safeParse({ clipId: VALID_UUID, reason: 'a'.repeat(501) }).success
      ).toBe(false);
    });
  });

  describe('UpdateClipSchema', () => {
    it('accepts valid update data and transforms genre to uppercase', () => {
      const result = UpdateClipSchema.safeParse({
        title: 'New Title',
        genre: 'comedy',
        status: 'active',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.genre).toBe('COMEDY');
      }
    });

    it('rejects invalid status', () => {
      const result = UpdateClipSchema.safeParse({
        title: 'Title',
        genre: 'comedy',
        status: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreateSeasonSchema', () => {
    it('accepts minimal valid data with defaults', () => {
      const result = CreateSeasonSchema.safeParse({ name: 'Season 1' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.total_slots).toBe(75);
        expect(result.data.auto_activate).toBe(false);
      }
    });

    it('rejects empty name', () => {
      expect(CreateSeasonSchema.safeParse({ name: '' }).success).toBe(false);
    });

    it('rejects total_slots over 200', () => {
      expect(
        CreateSeasonSchema.safeParse({ name: 'S1', total_slots: 201 }).success
      ).toBe(false);
    });
  });

  describe('BatchModerationSchema', () => {
    it('accepts valid batch moderation', () => {
      const result = BatchModerationSchema.safeParse({
        clip_ids: [VALID_UUID],
        action: 'approve',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty clip_ids', () => {
      const result = BatchModerationSchema.safeParse({
        clip_ids: [],
        action: 'approve',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid action', () => {
      const result = BatchModerationSchema.safeParse({
        clip_ids: [VALID_UUID],
        action: 'delete',
      });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // AI schemas
  // =========================================================================
  describe('AIGenerateSchema', () => {
    it('accepts valid generation request', () => {
      const result = AIGenerateSchema.safeParse({
        prompt: 'A cinematic shot of a sunset over the ocean',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.model).toBe('kling-2.6'); // default
      }
    });

    it('rejects prompt shorter than 10 characters', () => {
      const result = AIGenerateSchema.safeParse({ prompt: 'short' });
      expect(result.success).toBe(false);
    });

    it('rejects prompt longer than 500 characters', () => {
      const result = AIGenerateSchema.safeParse({ prompt: 'a'.repeat(501) });
      expect(result.success).toBe(false);
    });

    it('rejects unknown fields (strict mode)', () => {
      const result = AIGenerateSchema.safeParse({
        prompt: 'A valid prompt here 1234',
        unknownField: 'value',
      });
      expect(result.success).toBe(false);
    });

    it('accepts all valid models', () => {
      for (const model of AI_MODELS) {
        const result = AIGenerateSchema.safeParse({
          prompt: 'A valid prompt here 1234',
          model,
        });
        expect(result.success).toBe(true);
      }
    });

    it('accepts all valid styles', () => {
      for (const style of AI_STYLES) {
        const result = AIGenerateSchema.safeParse({
          prompt: 'A valid prompt here 1234',
          style,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('AINarrateSchema', () => {
    it('accepts valid narration request', () => {
      const result = AINarrateSchema.safeParse({
        generationId: VALID_UUID,
        text: 'Hello world narration',
        voiceId: 'voice-1',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty text', () => {
      const result = AINarrateSchema.safeParse({
        generationId: VALID_UUID,
        text: '',
        voiceId: 'voice-1',
      });
      expect(result.success).toBe(false);
    });

    it('rejects text over 300 characters', () => {
      const result = AINarrateSchema.safeParse({
        generationId: VALID_UUID,
        text: 'a'.repeat(301),
        voiceId: 'voice-1',
      });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // Co-Director schemas
  // =========================================================================
  describe('DirectionVoteSchema', () => {
    it('accepts valid UUID', () => {
      expect(
        DirectionVoteSchema.safeParse({ direction_option_id: VALID_UUID }).success
      ).toBe(true);
    });
  });

  describe('GenerateDirectionsSchema', () => {
    it('accepts valid season_id and slot_position', () => {
      const result = GenerateDirectionsSchema.safeParse({
        season_id: VALID_UUID,
        slot_position: 5,
      });
      expect(result.success).toBe(true);
    });

    it('rejects slot_position < 1', () => {
      const result = GenerateDirectionsSchema.safeParse({
        season_id: VALID_UUID,
        slot_position: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('OpenDirectionVoteSchema', () => {
    it('defaults duration_hours to 48', () => {
      const result = OpenDirectionVoteSchema.safeParse({
        season_id: VALID_UUID,
        slot_position: 1,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.duration_hours).toBe(48);
      }
    });

    it('rejects duration_hours over 168 (1 week)', () => {
      const result = OpenDirectionVoteSchema.safeParse({
        season_id: VALID_UUID,
        slot_position: 1,
        duration_hours: 169,
      });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // Movie schemas
  // =========================================================================
  describe('MovieScriptPreviewSchema', () => {
    it('accepts valid script preview request', () => {
      const result = MovieScriptPreviewSchema.safeParse({
        source_text: 'a'.repeat(100),
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.target_duration_minutes).toBe(10);
        expect(result.data.model).toBe('kling-2.6');
      }
    });

    it('rejects source_text shorter than 100 characters', () => {
      const result = MovieScriptPreviewSchema.safeParse({
        source_text: 'too short',
      });
      expect(result.success).toBe(false);
    });

    it('rejects source_text over 100000 characters', () => {
      const result = MovieScriptPreviewSchema.safeParse({
        source_text: 'a'.repeat(100001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('MovieProjectCreateSchema', () => {
    it('accepts valid project creation data', () => {
      const result = MovieProjectCreateSchema.safeParse({
        title: 'My Movie',
        source_text: 'a'.repeat(100),
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.aspect_ratio).toBe('16:9');
        expect(result.data.target_duration_minutes).toBe(10);
      }
    });
  });

  describe('MovieSceneUpdateSchema', () => {
    it('accepts valid scene updates', () => {
      const result = MovieSceneUpdateSchema.safeParse({
        scenes: [
          { scene_number: 1, video_prompt: 'A long enough prompt text' },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty scenes array', () => {
      const result = MovieSceneUpdateSchema.safeParse({ scenes: [] });
      expect(result.success).toBe(false);
    });

    it('rejects more than 200 scenes', () => {
      const scenes = Array.from({ length: 201 }, (_, i) => ({
        scene_number: i + 1,
      }));
      const result = MovieSceneUpdateSchema.safeParse({ scenes });
      expect(result.success).toBe(false);
    });
  });

  describe('MovieAccessGrantSchema', () => {
    it('accepts valid email with defaults', () => {
      const result = MovieAccessGrantSchema.safeParse({
        email: 'user@example.com',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.max_projects).toBe(5);
        expect(result.data.max_scenes_per_project).toBe(150);
      }
    });

    it('rejects invalid email', () => {
      const result = MovieAccessGrantSchema.safeParse({ email: 'not-an-email' });
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // Character reference schemas
  // =========================================================================
  describe('SuggestClipFrameSchema', () => {
    it('accepts valid source_clip_id and frame_timestamp', () => {
      const result = SuggestClipFrameSchema.safeParse({
        source_clip_id: VALID_UUID,
        frame_timestamp: 2.5,
      });
      expect(result.success).toBe(true);
    });

    it('rejects negative timestamp', () => {
      const result = SuggestClipFrameSchema.safeParse({
        source_clip_id: VALID_UUID,
        frame_timestamp: -1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects timestamp over 30', () => {
      const result = SuggestClipFrameSchema.safeParse({
        source_clip_id: VALID_UUID,
        frame_timestamp: 31,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ReviewSuggestionSchema', () => {
    it('accepts valid suggestion_id', () => {
      expect(
        ReviewSuggestionSchema.safeParse({ suggestion_id: VALID_UUID }).success
      ).toBe(true);
    });

    it('rejects admin_notes over 500 characters', () => {
      expect(
        ReviewSuggestionSchema.safeParse({
          suggestion_id: VALID_UUID,
          admin_notes: 'a'.repeat(501),
        }).success
      ).toBe(false);
    });
  });

  // =========================================================================
  // ALLOWED_GENRES, AI_MODELS, AI_STYLES constants
  // =========================================================================
  describe('constants', () => {
    it('ALLOWED_GENRES contains expected genres', () => {
      expect(ALLOWED_GENRES).toContain('thriller');
      expect(ALLOWED_GENRES).toContain('comedy');
      expect(ALLOWED_GENRES).toContain('action');
      expect(ALLOWED_GENRES).toContain('sci-fi');
      expect(ALLOWED_GENRES).toContain('romance');
      expect(ALLOWED_GENRES).toContain('animation');
      expect(ALLOWED_GENRES).toContain('horror');
      expect(ALLOWED_GENRES).toContain('drama');
      expect(ALLOWED_GENRES).toHaveLength(8);
    });

    it('AI_MODELS contains expected models', () => {
      expect(AI_MODELS).toContain('kling-2.6');
      expect(AI_MODELS).toContain('veo3-fast');
    });

    it('AI_STYLES contains expected styles', () => {
      expect(AI_STYLES).toContain('cinematic');
      expect(AI_STYLES).toContain('anime');
      expect(AI_STYLES).toContain('noir');
    });
  });

  // =========================================================================
  // parseBody helper
  // =========================================================================
  describe('parseBody', () => {
    it('returns success:true with parsed data for valid input', () => {
      const result = parseBody(VoteRequestSchema, { clipId: VALID_UUID });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.clipId).toBe(VALID_UUID);
      }
    });

    it('returns success:false with formatted error for invalid input', () => {
      const result = parseBody(VoteRequestSchema, { clipId: 'bad' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(typeof result.error).toBe('string');
        expect(result.error.length).toBeGreaterThan(0);
      }
    });

    it('returns success:false for missing data', () => {
      const result = parseBody(VoteRequestSchema, {});
      expect(result.success).toBe(false);
    });

    it('joins multiple errors with commas', () => {
      const result = parseBody(CreateCommentSchema, {});
      expect(result.success).toBe(false);
      if (!result.success) {
        // Should mention both clipId and comment_text issues
        expect(result.error).toContain(',');
      }
    });
  });

  // =========================================================================
  // XSS / injection edge cases
  // =========================================================================
  describe('XSS and injection edge cases', () => {
    it('VoteRequestSchema rejects script tag as clipId', () => {
      const result = VoteRequestSchema.safeParse({
        clipId: '<script>alert(1)</script>',
      });
      expect(result.success).toBe(false);
    });

    it('CreateCommentSchema accepts HTML in comment text (sanitization is elsewhere)', () => {
      // Zod schemas validate structure, not content sanitization
      const result = CreateCommentSchema.safeParse({
        clipId: VALID_UUID,
        comment_text: '<script>alert("xss")</script>',
      });
      // Should pass validation (content sanitization is a separate concern)
      expect(result.success).toBe(true);
    });

    it('RegisterClipSchema rejects javascript: URLs', () => {
      const result = RegisterClipSchema.safeParse({
        videoUrl: 'javascript:alert(1)',
        genre: 'comedy',
        title: 'Test',
        duration: 5,
      });
      expect(result.success).toBe(false);
    });
  });
});
