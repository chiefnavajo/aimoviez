// lib/validations.ts
// Zod validation schemas for API endpoints

import { z } from 'zod';

// =============================================================================
// VOTE VALIDATION
// =============================================================================

// Simplified to standard votes only (super/mega removed)
export const VoteRequestSchema = z.object({
  clipId: z.string().uuid('Invalid clip ID format'),
});

export type VoteRequest = z.infer<typeof VoteRequestSchema>;

// =============================================================================
// UPLOAD/REGISTER VALIDATION
// =============================================================================

export const ALLOWED_GENRES = [
  'thriller',
  'comedy',
  'action',
  'sci-fi',
  'romance',
  'animation',
  'horror',
  'drama',
] as const;

// Maximum video duration in seconds (8 seconds + small buffer for encoding variance)
const MAX_VIDEO_DURATION = 8.5;

export const RegisterClipSchema = z.object({
  videoUrl: z
    .string()
    .url('Invalid video URL')
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'https:' && (
            parsed.hostname.endsWith('.supabase.co') ||
            parsed.hostname.endsWith('.r2.dev') ||
            parsed.hostname === 'cdn.aimoviez.app'
          );
        } catch { return false; }
      },
      'Video URL must be from an allowed storage provider'
    ),
  genre: z
    .string()
    .min(1, 'Genre is required')
    .transform((g) => g.toLowerCase())
    .refine(
      (g) => ALLOWED_GENRES.includes(g as any),
      `Genre must be one of: ${ALLOWED_GENRES.join(', ')}`
    ),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(100, 'Title must be 100 characters or less')
    .transform((t) => t.trim()),
  description: z
    .string()
    .max(500, 'Description must be 500 characters or less')
    .optional()
    .transform((d) => d?.trim() || ''),
  duration: z
    .number({ error: 'Video duration is required' })
    .min(0.1, 'Video duration must be positive')
    .max(MAX_VIDEO_DURATION, `Video must be ${MAX_VIDEO_DURATION} seconds or less`),
});

export type RegisterClipRequest = z.infer<typeof RegisterClipSchema>;

// =============================================================================
// COMMENT VALIDATION
// =============================================================================

export const CreateCommentSchema = z.object({
  // clipId can be a clip UUID or season UUID (for story page comments)
  clipId: z.string().uuid('Invalid content ID format'),
  comment_text: z
    .string()
    .min(1, 'Comment text is required')
    .max(500, 'Comment must be 500 characters or less')
    .transform((t) => t.trim())
    .refine((t) => t.length > 0, 'Comment cannot be empty after trimming'),
  parent_comment_id: z.string().uuid().optional().nullable(),
});

export type CreateCommentRequest = z.infer<typeof CreateCommentSchema>;

export const LikeCommentSchema = z.object({
  comment_id: z.string().uuid('Invalid comment ID format'),
  action: z.enum(['like', 'unlike']),
});

export type LikeCommentRequest = z.infer<typeof LikeCommentSchema>;

export const DeleteCommentSchema = z.object({
  comment_id: z.string().uuid('Invalid comment ID format'),
});

export type DeleteCommentRequest = z.infer<typeof DeleteCommentSchema>;

// =============================================================================
// GENRE VOTE VALIDATION
// =============================================================================

const VOTABLE_GENRES = [
  'Thriller',
  'Comedy',
  'Action',
  'Sci-Fi',
  'Romance',
  'Animation',
  'Horror',
  'Drama',
] as const;

export const GenreVoteSchema = z.object({
  genre: z.enum(VOTABLE_GENRES, {
    message: `Genre must be one of: ${VOTABLE_GENRES.join(', ')}`,
  }),
});

export type GenreVoteRequest = z.infer<typeof GenreVoteSchema>;

// =============================================================================
// ADMIN VALIDATION
// =============================================================================

export const ApproveClipSchema = z.object({
  clipId: z.string().uuid('Invalid clip ID format'),
});

export const RejectClipSchema = z.object({
  clipId: z.string().uuid('Invalid clip ID format'),
  reason: z.string().max(500).optional(),
});

export const UpdateClipSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(100, 'Title must be 100 characters or less')
    .transform((t) => t.trim()),
  description: z
    .string()
    .max(500)
    .optional()
    .transform((d) => d?.trim() || ''),
  genre: z
    .string()
    .min(1, 'Genre is required')
    .transform((g) => g.toUpperCase()),
  status: z.enum(['pending', 'active', 'rejected']),
});

export type UpdateClipRequest = z.infer<typeof UpdateClipSchema>;

export const CreateSeasonSchema = z.object({
  name: z.string().min(1, 'Season name is required').max(100),
  description: z.string().max(500).optional(),
  total_slots: z.number().int().min(1).max(200).optional().default(75),
  auto_activate: z.boolean().optional().default(false),
});

export type CreateSeasonRequest = z.infer<typeof CreateSeasonSchema>;

export const UpdateSlotSchema = z.object({
  slot_id: z.string().uuid('Invalid slot ID format'),
  status: z.enum(['upcoming', 'voting', 'locked', 'archived', 'waiting_for_clips']).optional(),
  winning_clip_id: z.string().uuid().optional().nullable(),
});

export type UpdateSlotRequest = z.infer<typeof UpdateSlotSchema>;

export const BatchModerationSchema = z.object({
  clip_ids: z.array(z.string().uuid()).min(1, 'At least one clip ID required'),
  action: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
});

export type BatchModerationRequest = z.infer<typeof BatchModerationSchema>;

// =============================================================================
// AI VIDEO GENERATION VALIDATION
// =============================================================================

export const AI_MODELS = ['kling-2.6', 'veo3-fast', 'hailuo-2.3', 'sora-2'] as const;
export const AI_STYLES = ['cinematic', 'anime', 'realistic', 'abstract', 'noir', 'retro', 'neon'] as const;

export const AIGenerateSchema = z.object({
  prompt: z
    .string()
    .min(10, 'Prompt must be at least 10 characters')
    .max(500, 'Prompt must be 500 characters or less')
    .transform((t) => t.trim()),
  model: z.enum(AI_MODELS).default('kling-2.6'),
  style: z.enum(AI_STYLES).optional(),
  genre: z.string().optional(),
  image_url: z.string().url().optional(),
}).strict();

export type AIGenerateRequest = z.infer<typeof AIGenerateSchema>;

export const AIRegisterSchema = z.object({
  generationId: z.string().uuid('Invalid generation ID'),
  genre: z
    .string()
    .min(1, 'Genre is required')
    .transform((g) => g.toLowerCase())
    .refine(
      (g) => ALLOWED_GENRES.includes(g as any),
      `Genre must be one of: ${ALLOWED_GENRES.join(', ')}`
    ),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(100, 'Title must be 100 characters or less')
    .transform((t) => t.trim()),
  description: z
    .string()
    .max(500, 'Description must be 500 characters or less')
    .optional()
    .transform((d) => d?.trim() || ''),
}).strict();

export type AIRegisterRequest = z.infer<typeof AIRegisterSchema>;

// =============================================================================
// HELPER: Parse and validate with friendly error
// =============================================================================

export function parseBody<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format error message (Zod v4 uses issues instead of errors)
  const issues = result.error.issues || [];
  const errorMessages = issues.map((issue) => issue.message).join(', ');
  return { success: false, error: errorMessages || 'Validation failed' };
}
