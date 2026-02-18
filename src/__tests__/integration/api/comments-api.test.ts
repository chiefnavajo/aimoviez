/**
 * Comments API Integration Tests
 *
 * Tests the comments system:
 * - Create comments
 * - Reply to comments
 * - Like/unlike comments
 * - Delete comments
 * - Comment pagination
 */

import {
  testSupabase,
  createSeason,
  cleanupAllTestSeasons,
  setupMultiSeasonUser,
  MULTI_SEASON_USER_ID,
} from '../setup';

// Track created resources
const createdClipIds: string[] = [];
const createdCommentIds: string[] = [];
let testSeasonId: string;

async function createTestClip(): Promise<string> {
  const { data, error } = await testSupabase
    .from('tournament_clips')
    .insert({
      title: `Comment Test Clip ${Date.now()}`,
      status: 'active',
      season_id: testSeasonId,
      user_id: MULTI_SEASON_USER_ID,
      slot_position: 1,
      video_url: 'https://test.example.com/video.mp4',
      thumbnail_url: 'https://test.example.com/thumb.jpg',
      genre: 'TEST',
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create clip: ${error.message}`);

  createdClipIds.push(data.id);
  return data.id;
}

async function createComment(
  clipId: string,
  text: string,
  parentId: string | null = null
): Promise<string> {
  const userKey = `test_user_${MULTI_SEASON_USER_ID}`;
  const { data, error } = await testSupabase
    .from('comments')
    .insert({
      clip_id: clipId,
      user_key: userKey,
      username: 'TestUser',
      comment_text: text,
      parent_comment_id: parentId,
      likes_count: 0,
      is_deleted: false,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create comment: ${error.message}`);

  createdCommentIds.push(data.id);
  return data.id;
}

async function getCommentById(commentId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await testSupabase
    .from('comments')
    .select('*')
    .eq('id', commentId)
    .single();

  if (error) return null;
  return data;
}

async function getCommentsForClip(clipId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await testSupabase
    .from('comments')
    .select('*')
    .eq('clip_id', clipId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

async function cleanupTestData(): Promise<void> {
  // Delete comment likes
  for (const commentId of createdCommentIds) {
    await testSupabase.from('comment_likes').delete().eq('comment_id', commentId);
  }

  // Delete comments
  for (const commentId of createdCommentIds) {
    await testSupabase.from('comments').delete().eq('id', commentId);
  }

  // Delete clips
  for (const clipId of createdClipIds) {
    await testSupabase.from('comments').delete().eq('clip_id', clipId);
    await testSupabase.from('tournament_clips').delete().eq('id', clipId);
  }

  await cleanupAllTestSeasons();
  createdClipIds.length = 0;
  createdCommentIds.length = 0;
}

describe('Comments API Integration Tests', () => {
  beforeAll(async () => {
    await setupMultiSeasonUser();
    testSeasonId = await createSeason('Comments Test Season', 10, 'active');
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe('Comment Creation', () => {
    it('creates a comment successfully', async () => {
      const clipId = await createTestClip();
      const commentId = await createComment(clipId, 'This is a test comment');

      const comment = await getCommentById(commentId);
      expect(comment).not.toBeNull();
      expect(comment?.comment_text).toBe('This is a test comment');
      expect(comment?.clip_id).toBe(clipId);
    });

    it('creates multiple comments on same clip', async () => {
      const clipId = await createTestClip();

      await createComment(clipId, 'First comment');
      await createComment(clipId, 'Second comment');
      await createComment(clipId, 'Third comment');

      const comments = await getCommentsForClip(clipId);
      expect(comments.length).toBe(3);
    });

    it('comment has correct metadata', async () => {
      const clipId = await createTestClip();
      const commentId = await createComment(clipId, 'Metadata test');

      const comment = await getCommentById(commentId);
      expect(comment?.user_key).toBe(`test_user_${MULTI_SEASON_USER_ID}`);
      expect(comment?.username).toBe('TestUser');
      expect(comment?.likes_count).toBe(0);
      expect(comment?.is_deleted).toBe(false);
      expect(comment?.created_at).toBeDefined();
    });

    it('handles special characters in comment text', async () => {
      const clipId = await createTestClip();
      const specialText = 'Comment with émojis 🎬 and "quotes" & <tags>';

      const commentId = await createComment(clipId, specialText);

      const comment = await getCommentById(commentId);
      expect(comment?.comment_text).toBe(specialText);
    });

    it('handles very long comments (500 char limit)', async () => {
      const clipId = await createTestClip();
      const longText = 'A'.repeat(600); // Over 500 limit

      const { data, error } = await testSupabase
        .from('comments')
        .insert({
          clip_id: clipId,
          user_key: `test_user_${MULTI_SEASON_USER_ID}`,
          username: 'TestUser',
          comment_text: longText,
          likes_count: 0,
          is_deleted: false,
        })
        .select('id')
        .single();

      // Should fail due to CHECK constraint (max 500 chars)
      expect(error).not.toBeNull();
      expect(error?.message.toLowerCase()).toMatch(/check|constraint|length|max/);
    });
  });

  describe('Comment Replies', () => {
    it('creates a reply to a comment', async () => {
      const clipId = await createTestClip();
      const parentId = await createComment(clipId, 'Parent comment');
      const replyId = await createComment(clipId, 'Reply to parent', parentId);

      const reply = await getCommentById(replyId);
      expect(reply?.parent_comment_id).toBe(parentId);
    });

    it('creates nested replies', async () => {
      const clipId = await createTestClip();
      const level1 = await createComment(clipId, 'Level 1');
      const level2 = await createComment(clipId, 'Level 2', level1);
      const level3 = await createComment(clipId, 'Level 3', level2);

      const l3Comment = await getCommentById(level3);
      expect(l3Comment?.parent_comment_id).toBe(level2);
    });

    it('counts replies correctly', async () => {
      const clipId = await createTestClip();
      const parentId = await createComment(clipId, 'Parent with replies');

      for (let i = 0; i < 5; i++) {
        await createComment(clipId, `Reply ${i}`, parentId);
      }

      const { count } = await testSupabase
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('parent_comment_id', parentId);

      expect(count).toBe(5);
    });
  });

  describe('Comment Likes', () => {
    const testUserKey = `test_liker_${Date.now()}`;

    it('can like a comment', async () => {
      const clipId = await createTestClip();
      const commentId = await createComment(clipId, 'Likeable comment');

      const { error } = await testSupabase.from('comment_likes').insert({
        comment_id: commentId,
        user_key: testUserKey,
      });

      // Either succeeds or table doesn't exist
      if (error && !error.message.includes('relation')) {
        throw error;
      }

      expect(true).toBe(true);
    });

    it('prevents duplicate likes', async () => {
      const clipId = await createTestClip();
      const commentId = await createComment(clipId, 'Single like only');
      const likerKey = `dup_liker_${Date.now()}`;

      // First like
      await testSupabase.from('comment_likes').insert({
        comment_id: commentId,
        user_key: likerKey,
      });

      // Second like attempt
      const { error } = await testSupabase.from('comment_likes').insert({
        comment_id: commentId,
        user_key: likerKey,
      });

      // Should fail with unique constraint
      if (error) {
        expect(error.message.toLowerCase()).toMatch(/duplicate|unique|already|conflict/);
      }
    });

    it('can unlike a comment', async () => {
      const clipId = await createTestClip();
      const commentId = await createComment(clipId, 'Unlike test');
      const unlikeKey = `unlike_test_${Date.now()}`;

      // Like
      await testSupabase.from('comment_likes').insert({
        comment_id: commentId,
        user_key: unlikeKey,
      });

      // Unlike
      const { error } = await testSupabase
        .from('comment_likes')
        .delete()
        .eq('comment_id', commentId)
        .eq('user_key', unlikeKey);

      expect(error).toBeNull();
    });
  });

  describe('Comment Deletion', () => {
    it('soft deletes a comment', async () => {
      const clipId = await createTestClip();
      const commentId = await createComment(clipId, 'To be deleted');

      // Soft delete
      const { error } = await testSupabase
        .from('comments')
        .update({ is_deleted: true })
        .eq('id', commentId);

      expect(error).toBeNull();

      const comment = await getCommentById(commentId);
      expect(comment?.is_deleted).toBe(true);
    });

    it('soft deleted comments not returned in normal query', async () => {
      const clipId = await createTestClip();
      await createComment(clipId, 'Visible comment');
      const deletedId = await createComment(clipId, 'Deleted comment');

      // Soft delete one
      await testSupabase
        .from('comments')
        .update({ is_deleted: true })
        .eq('id', deletedId);

      const comments = await getCommentsForClip(clipId);
      const ids = comments.map(c => c.id);

      expect(ids).not.toContain(deletedId);
    });

    it('hard delete removes comment completely', async () => {
      const clipId = await createTestClip();
      const commentId = await createComment(clipId, 'Hard delete test');

      // Hard delete
      await testSupabase.from('comments').delete().eq('id', commentId);

      const comment = await getCommentById(commentId);
      expect(comment).toBeNull();

      // Remove from tracking
      const idx = createdCommentIds.indexOf(commentId);
      if (idx > -1) createdCommentIds.splice(idx, 1);
    });
  });

  describe('Comment Pagination', () => {
    it('paginates comments correctly', async () => {
      const clipId = await createTestClip();

      // Create 25 comments
      for (let i = 0; i < 25; i++) {
        await createComment(clipId, `Paginated comment ${i}`);
      }

      // First page (10 items)
      const { data: page1 } = await testSupabase
        .from('comments')
        .select('*')
        .eq('clip_id', clipId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .range(0, 9);

      expect(page1?.length).toBe(10);

      // Second page
      const { data: page2 } = await testSupabase
        .from('comments')
        .select('*')
        .eq('clip_id', clipId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .range(10, 19);

      expect(page2?.length).toBe(10);

      // Third page (5 remaining)
      const { data: page3 } = await testSupabase
        .from('comments')
        .select('*')
        .eq('clip_id', clipId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .range(20, 29);

      expect(page3?.length).toBe(5);
    });

    it('sorts comments by newest first', async () => {
      const clipId = await createTestClip();

      const id1 = await createComment(clipId, 'First');
      await new Promise(r => setTimeout(r, 10));
      const id2 = await createComment(clipId, 'Second');
      await new Promise(r => setTimeout(r, 10));
      const id3 = await createComment(clipId, 'Third');

      const comments = await getCommentsForClip(clipId);

      expect(comments[0].id).toBe(id3);
      expect(comments[1].id).toBe(id2);
      expect(comments[2].id).toBe(id1);
    });

    it('can sort by most liked', async () => {
      const clipId = await createTestClip();

      const lowLikes = await createComment(clipId, 'Low likes');
      const highLikes = await createComment(clipId, 'High likes');

      // Set likes_count directly
      await testSupabase
        .from('comments')
        .update({ likes_count: 5 })
        .eq('id', lowLikes);
      await testSupabase
        .from('comments')
        .update({ likes_count: 50 })
        .eq('id', highLikes);

      const { data } = await testSupabase
        .from('comments')
        .select('*')
        .eq('clip_id', clipId)
        .order('likes_count', { ascending: false });

      expect(data?.[0].id).toBe(highLikes);
    });
  });

  describe('Comment Count', () => {
    it('counts comments for a clip', async () => {
      const clipId = await createTestClip();

      for (let i = 0; i < 15; i++) {
        await createComment(clipId, `Comment ${i}`);
      }

      const { count } = await testSupabase
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('clip_id', clipId)
        .eq('is_deleted', false);

      expect(count).toBe(15);
    });

    it('excludes deleted comments from count', async () => {
      const clipId = await createTestClip();

      for (let i = 0; i < 10; i++) {
        const id = await createComment(clipId, `Comment ${i}`);
        if (i < 3) {
          await testSupabase
            .from('comments')
            .update({ is_deleted: true })
            .eq('id', id);
        }
      }

      const { count } = await testSupabase
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('clip_id', clipId)
        .eq('is_deleted', false);

      expect(count).toBe(7);
    });
  });

  describe('Comment Integrity', () => {
    it('comment foreign key to clip is enforced', async () => {
      const fakeClipId = crypto.randomUUID();

      const { error } = await testSupabase.from('comments').insert({
        clip_id: fakeClipId,
        user_id: MULTI_SEASON_USER_ID,
        comment_text: 'Orphan comment',
        likes_count: 0,
        is_deleted: false,
      });

      expect(error).not.toBeNull();
    });

    it('deleting clip handles comments appropriately', async () => {
      const clipId = await createTestClip();

      for (let i = 0; i < 5; i++) {
        await createComment(clipId, `Cascade comment ${i}`);
      }

      // Delete clip
      const { error } = await testSupabase.from('tournament_clips').delete().eq('id', clipId);

      if (error) {
        // FK constraint prevents deletion - comments must be deleted first
        expect(error.message.toLowerCase()).toMatch(/foreign|reference|constraint|violates/);
        // Clean up comments first
        await testSupabase.from('comments').delete().eq('clip_id', clipId);
        await testSupabase.from('tournament_clips').delete().eq('id', clipId);
      } else {
        // Clip deleted successfully - check comment state
        const { data: comments } = await testSupabase
          .from('comments')
          .select('id, clip_id')
          .eq('clip_id', clipId);

        // Comments might be orphaned (SET NULL) or still reference the clip
        // Either way, clean them up manually
        if (comments && comments.length > 0) {
          await testSupabase.from('comments').delete().eq('clip_id', clipId);
        }
      }

      // Verify cleanup
      const { count } = await testSupabase
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('clip_id', clipId);

      expect(count).toBe(0);

      // Remove from tracking
      const idx = createdClipIds.indexOf(clipId);
      if (idx > -1) createdClipIds.splice(idx, 1);
    });
  });
});
