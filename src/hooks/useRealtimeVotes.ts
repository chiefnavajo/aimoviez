// hooks/useRealtimeVotes.ts
// ============================================================================
// REAL-TIME VOTE BROADCAST HOOK
// Subscribes to Supabase Broadcast 'votes' channel for live vote updates.
// Visibility-aware: disconnects when tab is hidden, reconnects on focus.
// Falls back gracefully if connection fails.
// ============================================================================

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { getRealtimeClient } from '@/lib/supabase-client';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface VoteUpdatePayload {
  clipId: string;
  voteCount: number;
  weightedScore: number;
  timestamp: number;
}

interface UseRealtimeVoteBroadcastOptions {
  onVoteUpdate?: (payload: VoteUpdatePayload) => void;
  enabled?: boolean;
}

// ============================================================================
// HOOK
// ============================================================================

export function useRealtimeVoteBroadcast({
  onVoteUpdate,
  enabled = true,
}: UseRealtimeVoteBroadcastOptions = {}) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isSubscribingRef = useRef(false);
  const mountedRef = useRef(true);
  const onVoteUpdateRef = useRef(onVoteUpdate);

  // Keep callback ref fresh without resubscribing
  useEffect(() => {
    onVoteUpdateRef.current = onVoteUpdate;
  }, [onVoteUpdate]);

  const subscribe = useCallback(() => {
    if (!mountedRef.current || !enabled) return;
    if (channelRef.current || isSubscribingRef.current) return;

    isSubscribingRef.current = true;

    try {
      const client = getRealtimeClient();
      const channel = client
        .channel('votes')
        .on('broadcast', { event: 'vote-update' }, (payload) => {
          if (onVoteUpdateRef.current && payload.payload) {
            onVoteUpdateRef.current(payload.payload as VoteUpdatePayload);
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channelRef.current = channel;
            isSubscribingRef.current = false;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[RealtimeVotes] Subscription failed:', status);
            isSubscribingRef.current = false;
          }
        });
    } catch {
      isSubscribingRef.current = false;
    }
  }, [enabled]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      const client = getRealtimeClient();
      client.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    isSubscribingRef.current = false;
  }, []);

  // Main effect: subscribe on mount, unsubscribe on unmount
  useEffect(() => {
    mountedRef.current = true;
    if (enabled) {
      subscribe();
    }

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [enabled, subscribe, unsubscribe]);

  // Visibility-aware: disconnect when tab hidden, reconnect on visible
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (!channelRef.current && mountedRef.current) {
          subscribe();
        }
      } else {
        unsubscribe();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, subscribe, unsubscribe]);
}
