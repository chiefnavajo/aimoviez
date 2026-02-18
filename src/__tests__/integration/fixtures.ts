/**
 * Shared Test Fixtures
 *
 * Centralized test data creation and management.
 * Reduces duplication and ensures consistent test data.
 */

import { testSupabase, MULTI_SEASON_USER_ID } from './setup';

// ============================================================================
// TRACKING ARRAYS - For automatic cleanup
// ============================================================================

export const trackedResources = {
  clips: [] as string[],
  comments: [] as string[],
  votes: [] as string[],
  users: [] as string[],
  generations: [] as string[],
  seasons: [] as string[],
};

// ============================================================================
// CLIP FIXTURES
// ============================================================================

export interface ClipFixture {
  id: string;
  title: string;
  status: string;
  seasonId: string;
  slotPosition: number | null;
}

export async function createClip(
  seasonId: string,
  options: {
    title?: string;
    status?: 'pending' | 'active' | 'locked' | 'rejected';
    slotPosition?: number | null;
    userId?: string;
  } = {}
): Promise<ClipFixture> {
  const {
    title = `Test Clip ${Date.now()}`,
    status = 'pending',
    slotPosition = null,
    userId = MULTI_SEASON_USER_ID,
  } = options;

  const { data, error } = await testSupabase
    .from('tournament_clips')
    .insert({
      title,
      status,
      season_id: seasonId,
      user_id: userId,
      slot_position: slotPosition,
      video_url: 'https://test.example.com/video.mp4',
      thumbnail_url: 'https://test.example.com/thumb.jpg',
      genre: 'TEST',
    })
    .select('id, title, status, season_id, slot_position')
    .single();

  if (error) {
    throw new FixtureError('clip', 'create', error.message);
  }

  trackedResources.clips.push(data.id);

  return {
    id: data.id,
    title: data.title,
    status: data.status,
    seasonId: data.season_id,
    slotPosition: data.slot_position,
  };
}

export async function createActiveClip(
  seasonId: string,
  slotPosition: number = 1
): Promise<ClipFixture> {
  return createClip(seasonId, { status: 'active', slotPosition });
}

export async function createPendingClip(seasonId: string): Promise<ClipFixture> {
  return createClip(seasonId, { status: 'pending' });
}

export async function createClipBatch(
  seasonId: string,
  count: number,
  options: { status?: 'pending' | 'active'; slotPosition?: number } = {}
): Promise<ClipFixture[]> {
  const clips: ClipFixture[] = [];
  for (let i = 0; i < count; i++) {
    const clip = await createClip(seasonId, {
      title: `Batch Clip ${i + 1}`,
      ...options,
    });
    clips.push(clip);
  }
  return clips;
}

// ============================================================================
// VOTE FIXTURES
// ============================================================================

export interface VoteFixture {
  voterKey: string;
  clipId: string;
  slotPosition: number;
  weight: number;
}

export async function createVote(
  clipId: string,
  options: {
    voterKey?: string;
    slotPosition?: number;
    weight?: number;
  } = {}
): Promise<VoteFixture> {
  const {
    voterKey = `voter_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    slotPosition = 1,
    weight = 1,
  } = options;

  const { error } = await testSupabase.from('votes').insert({
    voter_key: voterKey,
    clip_id: clipId,
    slot_position: slotPosition,
    vote_weight: weight,
  });

  if (error) {
    throw new FixtureError('vote', 'create', error.message);
  }

  trackedResources.votes.push(voterKey);

  return { voterKey, clipId, slotPosition, weight };
}

export async function createVoteBatch(
  clipId: string,
  count: number,
  options: { slotPosition?: number; weight?: number } = {}
): Promise<VoteFixture[]> {
  const votes: VoteFixture[] = [];
  for (let i = 0; i < count; i++) {
    const vote = await createVote(clipId, {
      voterKey: `batch_voter_${Date.now()}_${i}`,
      ...options,
    });
    votes.push(vote);
  }
  return votes;
}

export async function getVoteCount(clipId: string): Promise<number> {
  const { count, error } = await testSupabase
    .from('votes')
    .select('id', { count: 'exact', head: true })
    .eq('clip_id', clipId);

  if (error) {
    throw new FixtureError('vote', 'count', error.message);
  }

  return count || 0;
}

// ============================================================================
// COMMENT FIXTURES
// ============================================================================

export interface CommentFixture {
  id: string;
  clipId: string;
  userKey: string;
  text: string;
  parentId: string | null;
}

export async function createComment(
  clipId: string,
  options: {
    text?: string;
    userKey?: string;
    username?: string;
    parentId?: string | null;
  } = {}
): Promise<CommentFixture> {
  const {
    text = `Test comment ${Date.now()}`,
    userKey = `user_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    username = 'TestUser',
    parentId = null,
  } = options;

  const { data, error } = await testSupabase
    .from('comments')
    .insert({
      clip_id: clipId,
      user_key: userKey,
      username,
      comment_text: text,
      parent_comment_id: parentId,
      likes_count: 0,
      is_deleted: false,
    })
    .select('id')
    .single();

  if (error) {
    throw new FixtureError('comment', 'create', error.message);
  }

  trackedResources.comments.push(data.id);

  return {
    id: data.id,
    clipId,
    userKey,
    text,
    parentId,
  };
}

export async function createCommentThread(
  clipId: string,
  depth: number = 3
): Promise<CommentFixture[]> {
  const comments: CommentFixture[] = [];
  let parentId: string | null = null;

  for (let i = 0; i < depth; i++) {
    const comment = await createComment(clipId, {
      text: `Thread level ${i + 1}`,
      parentId,
    });
    comments.push(comment);
    parentId = comment.id;
  }

  return comments;
}

// ============================================================================
// USER FIXTURES
// ============================================================================

export interface UserFixture {
  id: string;
  username: string;
  email: string;
  balanceCredits: number;
}

export async function createUser(
  options: {
    username?: string;
    email?: string;
    balanceCredits?: number;
    isBanned?: boolean;
  } = {}
): Promise<UserFixture> {
  const id = crypto.randomUUID();
  const {
    username = `usr${Math.random().toString(36).slice(2, 10)}`,
    email = `test_${id.slice(0, 8)}@example.com`,
    balanceCredits = 0,
    isBanned = false,
  } = options;

  const { error } = await testSupabase.from('users').insert({
    id,
    username,
    email,
    balance_credits: balanceCredits,
    lifetime_purchased_credits: 0,
    is_banned: isBanned,
  });

  if (error) {
    throw new FixtureError('user', 'create', error.message);
  }

  trackedResources.users.push(id);

  return { id, username, email, balanceCredits };
}

export async function createUserWithCredits(credits: number): Promise<UserFixture> {
  return createUser({ balanceCredits: credits });
}

// ============================================================================
// AI GENERATION FIXTURES
// ============================================================================

export interface GenerationFixture {
  id: string;
  falRequestId: string;
  status: string;
  prompt: string;
}

export async function createGeneration(
  options: {
    userId?: string;
    prompt?: string;
    model?: string;
    status?: 'pending' | 'processing' | 'completed' | 'failed' | 'expired';
    creditAmount?: number | null;
  } = {}
): Promise<GenerationFixture> {
  const {
    userId = MULTI_SEASON_USER_ID,
    prompt = 'Test generation prompt',
    model = 'test-model',
    status = 'pending',
    creditAmount = null,
  } = options;

  const falRequestId = `fal_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const { data, error } = await testSupabase
    .from('ai_generations')
    .insert({
      user_id: userId,
      fal_request_id: falRequestId,
      prompt,
      model,
      status,
      credit_amount: creditAmount,
    })
    .select('id')
    .single();

  if (error) {
    throw new FixtureError('generation', 'create', error.message);
  }

  trackedResources.generations.push(data.id);

  return {
    id: data.id,
    falRequestId,
    status,
    prompt,
  };
}

// ============================================================================
// CLEANUP
// ============================================================================

export async function cleanupAllFixtures(): Promise<void> {
  // Delete in order of dependencies

  // Votes (depend on clips)
  for (const voterKey of trackedResources.votes) {
    await testSupabase.from('votes').delete().eq('voter_key', voterKey);
  }

  // Comment likes (depend on comments)
  for (const commentId of trackedResources.comments) {
    await testSupabase.from('comment_likes').delete().eq('comment_id', commentId);
  }

  // Comments (depend on clips)
  for (const commentId of trackedResources.comments) {
    await testSupabase.from('comments').delete().eq('id', commentId);
  }

  // Clear slot winners before deleting clips
  for (const seasonId of trackedResources.seasons) {
    await testSupabase
      .from('story_slots')
      .update({ winner_tournament_clip_id: null })
      .eq('season_id', seasonId);
  }

  // Clips
  for (const clipId of trackedResources.clips) {
    await testSupabase.from('tournament_clips').delete().eq('id', clipId);
  }

  // Generations
  for (const genId of trackedResources.generations) {
    await testSupabase.from('ai_generations').delete().eq('id', genId);
  }

  // Users (except the multi-season user)
  for (const userId of trackedResources.users) {
    if (userId !== MULTI_SEASON_USER_ID) {
      await testSupabase.from('users').delete().eq('id', userId);
    }
  }

  // Reset tracking
  trackedResources.clips.length = 0;
  trackedResources.comments.length = 0;
  trackedResources.votes.length = 0;
  trackedResources.users.length = 0;
  trackedResources.generations.length = 0;
  trackedResources.seasons.length = 0;
}

// ============================================================================
// CUSTOM ERROR CLASS
// ============================================================================

export class FixtureError extends Error {
  constructor(
    public readonly resource: string,
    public readonly operation: string,
    public readonly details: string
  ) {
    super(`Fixture error [${resource}:${operation}]: ${details}`);
    this.name = 'FixtureError';
  }
}

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/**
 * Assert with descriptive error message
 */
export function assertDefined<T>(
  value: T | null | undefined,
  context: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${context} to be defined, but got ${value}`);
  }
}

/**
 * Assert count matches expected
 */
export function assertCount(
  actual: number,
  expected: number,
  context: string
): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${context} count to be ${expected}, but got ${actual}`
    );
  }
}

/**
 * Assert status matches expected
 */
export function assertStatus(
  actual: string,
  expected: string,
  context: string
): void {
  if (actual !== expected) {
    throw new Error(
      `Expected ${context} status to be "${expected}", but got "${actual}"`
    );
  }
}
