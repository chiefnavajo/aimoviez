// lib/validations.ts
// Zod validation schemas for API endpoints

import { z } from 'zod';

// =============================================================================
// VOTE VALIDATION
// =============================================================================

export const VoteTypeSchema = z.enum(['standard', 'super', 'mega']);

export const VoteRequestSchema = z.object({
  clipId: z.string().uuid('Invalid clip ID format'),
  voteType: VoteTypeSchema.optional().default('standard'),
});

export type VoteRequest = z.infer<typeof VoteRequestSchema>;

// =============================================================================
// UPLOAD/REGISTER VALIDATION
// =============================================================================

const ALLOWED_GENRES = [
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
      (url) => url.includes('supabase') || url.startsWith('https://'),
      'Video URL must be a valid HTTPS URL'
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
    .number()
    .min(0.1, 'Video duration is required')
    .max(MAX_VIDEO_DURATION, `Video must be ${MAX_VIDEO_DURATION} seconds or less`)
    .optional(),
});

export type RegisterClipRequest = z.infer<typeof RegisterClipSchema>;

// =============================================================================
// COMMENT VALIDATION
// =============================================================================

export const CreateCommentSchema = z.object({
  clipId: z.string().uuid('Invalid clip ID format'),
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
    .transform((g) => g.toLowerCase()),
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
  status: z.enum(['upcoming', 'voting', 'locked', 'archived']).optional(),
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
