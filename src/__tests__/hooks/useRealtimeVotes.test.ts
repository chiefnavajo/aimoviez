// Tests for useRealtimeVoteBroadcast hook
// Verifies subscription, broadcast handling, unsubscribe, visibility, seasonId switching

import { renderHook, act, waitFor } from '@testing-library/react';

// Mock Supabase realtime client
const mockRemoveChannel = jest.fn();
const mockSubscribe = jest.fn((cb) => {
  // Call the callback asynchronously to match real Supabase behavior
  // and allow the `channel` variable assignment to complete first
  if (cb) setTimeout(() => cb('SUBSCRIBED'), 0);
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

import { useRealtimeVoteBroadcast } from '@/hooks/useRealtimeVotes';

describe('useRealtimeVoteBroadcast', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOn.mockReturnThis();
  });

  it('subscribes to the global votes channel when enabled', () => {
    renderHook(() =>
      useRealtimeVoteBroadcast({ onVoteUpdate: jest.fn(), enabled: true })
    );

    expect(mockChannelFactory).toHaveBeenCalledWith('votes');
    expect(mockOn).toHaveBeenCalledWith(
      'broadcast',
      { event: 'vote-update' },
      expect.any(Function)
    );
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it('subscribes to season-specific channel when seasonId is provided', () => {
    renderHook(() =>
      useRealtimeVoteBroadcast({
        onVoteUpdate: jest.fn(),
        enabled: true,
        seasonId: 'season-abc',
      })
    );

    expect(mockChannelFactory).toHaveBeenCalledWith('votes:season:season-abc');
  });

  it('does not subscribe when disabled', () => {
    renderHook(() =>
      useRealtimeVoteBroadcast({ enabled: false })
    );

    expect(mockChannelFactory).not.toHaveBeenCalled();
  });

  it('calls onVoteUpdate when broadcast is received', () => {
    const onVoteUpdate = jest.fn();

    renderHook(() =>
      useRealtimeVoteBroadcast({ onVoteUpdate, enabled: true })
    );

    // Find the broadcast handler registered on .on('broadcast', ...)
    const broadcastHandler = mockOn.mock.calls.find(
      (call) => call[0] === 'broadcast' && call[1]?.event === 'vote-update'
    )?.[2];

    expect(broadcastHandler).toBeDefined();

    // Simulate a broadcast payload
    const payload = {
      payload: {
        clipId: 'clip-1',
        voteCount: 42,
        weightedScore: 84.5,
        timestamp: Date.now(),
      },
    };
    broadcastHandler(payload);

    expect(onVoteUpdate).toHaveBeenCalledWith(payload.payload);
  });

  it('unsubscribes (removeChannel) on unmount', async () => {
    const onVoteUpdate = jest.fn();

    const { unmount } = renderHook(() =>
      useRealtimeVoteBroadcast({ onVoteUpdate, enabled: true })
    );

    // Wait for the async subscribe callback to fire, setting channelRef.current
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    unmount();

    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel);
  });

  it('resubscribes when seasonId changes', async () => {
    const onVoteUpdate = jest.fn();

    const { rerender } = renderHook(
      ({ seasonId }) =>
        useRealtimeVoteBroadcast({ onVoteUpdate, enabled: true, seasonId }),
      { initialProps: { seasonId: 'season-1' as string | undefined } }
    );

    expect(mockChannelFactory).toHaveBeenCalledWith('votes:season:season-1');

    // Wait for the async subscribe callback to set channelRef
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    mockRemoveChannel.mockClear();
    mockChannelFactory.mockClear();

    rerender({ seasonId: 'season-2' });

    // Should have removed old channel and subscribed to new one
    expect(mockRemoveChannel).toHaveBeenCalled();
    expect(mockChannelFactory).toHaveBeenCalledWith('votes:season:season-2');
  });
});
