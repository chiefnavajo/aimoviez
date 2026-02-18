/**
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE imports
// ---------------------------------------------------------------------------

const mockHttpSend = jest.fn().mockResolvedValue(undefined);
const mockRemoveChannel = jest.fn();
const mockChannel = jest.fn(() => ({
  httpSend: mockHttpSend,
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  })),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  broadcastVoteUpdate,
  broadcastCommentEvent,
  broadcastLeaderboardUpdate,
} from '@/lib/realtime-broadcast';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
});

describe('realtime-broadcast', () => {
  // -----------------------------------------------------------------------
  // broadcastVoteUpdate
  // -----------------------------------------------------------------------

  describe('broadcastVoteUpdate', () => {
    it('sends vote-update event to the global votes channel', async () => {
      await broadcastVoteUpdate('clip-1', 42, 100);

      expect(mockChannel).toHaveBeenCalledWith('votes');
      expect(mockHttpSend).toHaveBeenCalledWith('vote-update', expect.objectContaining({
        clipId: 'clip-1',
        voteCount: 42,
        weightedScore: 100,
      }));
    });

    it('sends to season-specific channel and global channel when seasonId is provided', async () => {
      await broadcastVoteUpdate('clip-2', 10, 50, 'season-abc');

      // Should create two channels: season-specific + global
      expect(mockChannel).toHaveBeenCalledWith('votes:season:season-abc');
      expect(mockChannel).toHaveBeenCalledWith('votes');
      expect(mockHttpSend).toHaveBeenCalledTimes(2);
    });

    it('includes timestamp in the payload', async () => {
      const before = Date.now();
      await broadcastVoteUpdate('clip-3', 5, 25);
      const after = Date.now();

      const payload = mockHttpSend.mock.calls[0][1];
      expect(payload.timestamp).toBeGreaterThanOrEqual(before);
      expect(payload.timestamp).toBeLessThanOrEqual(after);
    });

    it('cleans up channels after sending', async () => {
      await broadcastVoteUpdate('clip-1', 1, 1);

      // removeChannel is called on the supabase client with the channel object
      // The module calls sb.removeChannel(channel), so we need to check
      // that the channel object was passed to removeChannel
      // Since our mock returns a new object each time, we verify the call count
      // One channel created, one removeChannel call
      expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    });

    it('does not throw when httpSend fails', async () => {
      mockHttpSend.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        broadcastVoteUpdate('clip-1', 1, 1),
      ).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // broadcastCommentEvent
  // -----------------------------------------------------------------------

  describe('broadcastCommentEvent', () => {
    it('sends event to clip-specific comment channel', async () => {
      await broadcastCommentEvent('clip-42', 'new-comment', {
        commentId: 'c-1',
        text: 'Great clip!',
      });

      expect(mockChannel).toHaveBeenCalledWith('comments:clip-42');
      expect(mockHttpSend).toHaveBeenCalledWith('new-comment', expect.objectContaining({
        clipId: 'clip-42',
        commentId: 'c-1',
        text: 'Great clip!',
      }));
    });

    it('supports comment-liked event', async () => {
      await broadcastCommentEvent('clip-5', 'comment-liked', { commentId: 'c-2' });

      expect(mockHttpSend).toHaveBeenCalledWith('comment-liked', expect.objectContaining({
        clipId: 'clip-5',
        commentId: 'c-2',
      }));
    });

    it('supports comment-deleted event', async () => {
      await broadcastCommentEvent('clip-5', 'comment-deleted', { commentId: 'c-3' });

      expect(mockHttpSend).toHaveBeenCalledWith('comment-deleted', expect.objectContaining({
        commentId: 'c-3',
      }));
    });

    it('cleans up channel after sending', async () => {
      await broadcastCommentEvent('clip-1', 'new-comment', {});

      expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    });

    it('does not throw when httpSend fails', async () => {
      mockHttpSend.mockRejectedValueOnce(new Error('Send failed'));

      await expect(
        broadcastCommentEvent('clip-1', 'new-comment', {}),
      ).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // broadcastLeaderboardUpdate
  // -----------------------------------------------------------------------

  describe('broadcastLeaderboardUpdate', () => {
    it('sends refresh event to leaderboard channel', async () => {
      await broadcastLeaderboardUpdate();

      expect(mockChannel).toHaveBeenCalledWith('leaderboard');
      expect(mockHttpSend).toHaveBeenCalledWith('refresh', expect.objectContaining({
        timestamp: expect.any(Number),
      }));
    });

    it('cleans up channel after sending', async () => {
      await broadcastLeaderboardUpdate();

      expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    });

    it('does not throw when httpSend fails', async () => {
      mockHttpSend.mockRejectedValueOnce(new Error('Broadcast down'));

      await expect(broadcastLeaderboardUpdate()).resolves.toBeUndefined();
    });
  });
});
