// Tests for useTeamChat hook fix: HS-7
// Verifies sendMessage reference stability via ref pattern

import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock Supabase realtime
const mockRemoveChannel = jest.fn();
const mockSubscribe = jest.fn((cb) => { if (cb) cb('SUBSCRIBED'); return mockChannel; });
const mockOn = jest.fn().mockReturnThis();
const mockChannel = { on: mockOn, subscribe: mockSubscribe };

jest.mock('@/lib/supabase-client', () => ({
  getRealtimeClient: jest.fn(() => ({
    channel: jest.fn(() => mockChannel),
    removeChannel: mockRemoveChannel,
  })),
}));

// Mock fetch for messages API
global.fetch = jest.fn().mockImplementation((url: string) => {
  if (url.includes('/messages')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, messages: [], has_more: false }),
    });
  }
  // CSRF token fetch
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
});

import { useTeamChatFull } from '@/hooks/useTeamChat';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useTeamChatFull (HS-7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sendMessage reference is stable across re-renders', () => {
    const wrapper = createWrapper();

    const { result, rerender } = renderHook(
      () => useTeamChatFull('team-123'),
      { wrapper }
    );

    const firstRef = result.current.sendMessage;

    // Trigger re-render
    rerender();
    const secondRef = result.current.sendMessage;

    // HS-7: sendMessage should be stable (same reference) because it uses
    // useCallback with only teamId as dependency, and mutateAsync is stored in a ref
    expect(firstRef).toBe(secondRef);
  });

  it('sendMessage reference changes when teamId changes', () => {
    const wrapper = createWrapper();

    const { result, rerender } = renderHook(
      ({ teamId }) => useTeamChatFull(teamId),
      { wrapper, initialProps: { teamId: 'team-1' as string | null } }
    );

    const firstRef = result.current.sendMessage;

    rerender({ teamId: 'team-2' });
    const secondRef = result.current.sendMessage;

    // Reference should change because teamId is in the dependency array
    expect(firstRef).not.toBe(secondRef);
  });
});
