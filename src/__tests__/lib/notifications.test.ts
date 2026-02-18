/**
 * @jest-environment node
 */

// Mock dependencies before imports
const mockInsert = jest.fn();
const mockSelect = jest.fn();
const mockSingle = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: mockInsert,
    })),
  })),
}));

jest.mock('@/lib/sanitize', () => ({
  sanitizeUrl: jest.fn((url: string) => url),
}));

import { createNotification } from '@/lib/notifications';
import { sanitizeUrl } from '@/lib/sanitize';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

  // Set up the default mock chain: insert -> select -> single
  mockSingle.mockResolvedValue({
    data: {
      id: 'notif-1',
      user_key: 'user_abc',
      type: 'clip_approved',
      title: 'Test',
      message: 'Test message',
      is_read: false,
    },
    error: null,
  });
  mockSelect.mockReturnValue({ single: mockSingle });
  mockInsert.mockReturnValue({ select: mockSelect });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// createNotification
// ---------------------------------------------------------------------------

describe('createNotification', () => {
  it('returns null when Supabase URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const result = await createNotification({
      user_key: 'user_abc',
      type: 'clip_approved',
      title: 'Approved',
      message: 'Your clip was approved',
    });

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Missing Supabase environment variables')
    );
  });

  it('returns null when Supabase service key is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const result = await createNotification({
      user_key: 'user_abc',
      type: 'clip_approved',
      title: 'Approved',
      message: 'Your clip was approved',
    });

    expect(result).toBeNull();
  });

  it('creates a notification with correct parameters', async () => {
    const result = await createNotification({
      user_key: 'user_abc',
      type: 'clip_approved',
      title: 'Clip Approved',
      message: 'Your clip has been approved!',
      action_url: 'https://example.com/clip/123',
      metadata: { clipId: '123' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'notif-1',
        user_key: 'user_abc',
        type: 'clip_approved',
      })
    );

    // Verify insert was called with correct data
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertedData = mockInsert.mock.calls[0][0];
    expect(insertedData.user_key).toBe('user_abc');
    expect(insertedData.type).toBe('clip_approved');
    expect(insertedData.title).toBe('Clip Approved');
    expect(insertedData.message).toBe('Your clip has been approved!');
    expect(insertedData.is_read).toBe(false);
    expect(insertedData.metadata).toEqual({ clipId: '123' });
    expect(insertedData.created_at).toBeDefined();
  });

  it('sanitizes the action_url via sanitizeUrl', async () => {
    await createNotification({
      user_key: 'user_abc',
      type: 'system_announcement',
      title: 'Announcement',
      message: 'Check this out',
      action_url: 'https://example.com/page',
    });

    expect(sanitizeUrl).toHaveBeenCalledWith('https://example.com/page');
  });

  it('sets action_url to null when not provided', async () => {
    await createNotification({
      user_key: 'user_abc',
      type: 'daily_goal_reached',
      title: 'Goal!',
      message: 'You reached your daily goal',
    });

    const insertedData = mockInsert.mock.calls[0][0];
    expect(insertedData.action_url).toBeNull();
  });

  it('defaults metadata to empty object when not provided', async () => {
    await createNotification({
      user_key: 'user_abc',
      type: 'new_follower',
      title: 'New Follower',
      message: 'Someone followed you',
    });

    const insertedData = mockInsert.mock.calls[0][0];
    expect(insertedData.metadata).toEqual({});
  });

  it('returns null and logs error when insert fails', async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'insert failed', code: '42P01' },
    });

    const result = await createNotification({
      user_key: 'user_abc',
      type: 'vote_received',
      title: 'Vote',
      message: 'Someone voted on your clip',
    });

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      '[createNotification] error:',
      expect.objectContaining({ message: 'insert failed' })
    );
  });

  it('supports all notification types', async () => {
    const types = [
      'clip_approved',
      'clip_rejected',
      'clip_locked_in',
      'slot_voting_started',
      'achievement_unlocked',
      'daily_goal_reached',
      'new_follower',
      'comment_received',
      'vote_received',
      'system_announcement',
    ] as const;

    for (const type of types) {
      jest.clearAllMocks();
      mockSingle.mockResolvedValue({ data: { id: 'n', type }, error: null });
      mockSelect.mockReturnValue({ single: mockSingle });
      mockInsert.mockReturnValue({ select: mockSelect });

      await createNotification({
        user_key: 'user_abc',
        type,
        title: 'Test',
        message: 'Test',
      });

      const insertedData = mockInsert.mock.calls[0][0];
      expect(insertedData.type).toBe(type);
    }
  });
});
