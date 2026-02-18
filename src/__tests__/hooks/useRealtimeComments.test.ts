// Tests for useRealtimeComments hook
// Verifies subscription to clip-specific comment channels, broadcast handling, cleanup

import { renderHook } from '@testing-library/react';

// Mock Supabase realtime client
const mockRemoveChannel = jest.fn();
const mockSubscribe = jest.fn((cb) => {
  if (cb) cb('SUBSCRIBED');
  return mockChannel;
});
const mockOn = jest.fn().mockReturnThis();
const mockChannel = { on: mockOn, subscribe: mockSubscribe };
const mockChannelFactory = jest.fn(() => mockChannel);

jest.mock('@/lib/supabase-client', () => ({
  getRealtimeClient: jest.fn(() => ({
    channel: mockChannelFactory,
    removeChannel: mockRemoveChannel,
  })),
}));

import { useRealtimeComments } from '@/hooks/useRealtimeComments';

describe('useRealtimeComments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOn.mockReturnThis();
  });

  it('subscribes to clip-specific comments channel', () => {
    const onNewComment = jest.fn();

    renderHook(() =>
      useRealtimeComments('clip-123', { onNewComment, enabled: true })
    );

    expect(mockChannelFactory).toHaveBeenCalledWith('comments:clip-123');
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it('listens for new-comment, comment-liked, and comment-deleted events', () => {
    const onNewComment = jest.fn();
    const onCommentLiked = jest.fn();
    const onCommentDeleted = jest.fn();

    renderHook(() =>
      useRealtimeComments('clip-1', {
        onNewComment,
        onCommentLiked,
        onCommentDeleted,
        enabled: true,
      })
    );

    const eventTypes = mockOn.mock.calls.map((call) => call[1]?.event);
    expect(eventTypes).toContain('new-comment');
    expect(eventTypes).toContain('comment-liked');
    expect(eventTypes).toContain('comment-deleted');
  });

  it('calls onNewComment when broadcast is received', () => {
    const onNewComment = jest.fn();

    renderHook(() =>
      useRealtimeComments('clip-1', { onNewComment, enabled: true })
    );

    // Find the new-comment handler
    const handler = mockOn.mock.calls.find(
      (call) => call[0] === 'broadcast' && call[1]?.event === 'new-comment'
    )?.[2];

    expect(handler).toBeDefined();

    const payload = {
      payload: {
        clipId: 'clip-1',
        id: 'comment-1',
        username: 'alice',
        avatarUrl: 'https://example.com/avatar.png',
        commentText: 'Great clip!',
        timestamp: Date.now(),
      },
    };

    handler(payload);
    expect(onNewComment).toHaveBeenCalledWith(payload.payload);
  });

  it('does not subscribe when clipId is null', () => {
    renderHook(() =>
      useRealtimeComments(null, { onNewComment: jest.fn(), enabled: true })
    );

    expect(mockChannelFactory).not.toHaveBeenCalled();
  });

  it('does not subscribe when disabled', () => {
    renderHook(() =>
      useRealtimeComments('clip-1', { onNewComment: jest.fn(), enabled: false })
    );

    expect(mockChannelFactory).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() =>
      useRealtimeComments('clip-1', { onNewComment: jest.fn(), enabled: true })
    );

    unmount();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });

  it('resubscribes when clipId changes', () => {
    const onNewComment = jest.fn();

    const { rerender } = renderHook(
      ({ clipId }) => useRealtimeComments(clipId, { onNewComment, enabled: true }),
      { initialProps: { clipId: 'clip-1' as string | null } }
    );

    expect(mockChannelFactory).toHaveBeenCalledWith('comments:clip-1');

    mockRemoveChannel.mockClear();
    mockChannelFactory.mockClear();

    rerender({ clipId: 'clip-2' });

    // Old channel removed, new one created
    expect(mockRemoveChannel).toHaveBeenCalled();
    expect(mockChannelFactory).toHaveBeenCalledWith('comments:clip-2');
  });
});
