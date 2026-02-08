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
  seasonId?: string;
  timestamp: number;
}

interface UseRealtimeVoteBroadcastOptions {
  onVoteUpdate?: (payload: VoteUpdatePayload) => void;
  enabled?: boolean;
  /** Multi-genre: subscribe to season-specific channel instead of global */
  seasonId?: string;
}

// ============================================================================
// HOOK
// ============================================================================

export function useRealtimeVoteBroadcast({
  onVoteUpdate,
  enabled = true,
  seasonId,
}: UseRealtimeVoteBroadcastOptions = {}) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isSubscribingRef = useRef(false);
  const mountedRef = useRef(true);
  const onVoteUpdateRef = useRef(onVoteUpdate);
  const currentSeasonIdRef = useRef(seasonId);

  // Keep callback ref fresh without resubscribing
  useEffect(() => {
    onVoteUpdateRef.current = onVoteUpdate;
  }, [onVoteUpdate]);

  // Subscribe function takes seasonId as parameter to avoid stale closure
  const subscribeToSeason = useCallback((targetSeasonId: string | undefined) => {
    if (!mountedRef.current || !enabled) return;
    if (channelRef.current || isSubscribingRef.current) return;

    isSubscribingRef.current = true;
    currentSeasonIdRef.current = targetSeasonId;

    try {
      const client = getRealtimeClient();
      // Multi-genre: use season-specific channel if seasonId provided
      const channelName = targetSeasonId
        ? `votes:season:${targetSeasonId}`
        : 'votes';
      const channel = client
        .channel(channelName)
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

  // Wrapper for main effect compatibility
  const subscribe = useCallback(() => {
    subscribeToSeason(seasonId);
  }, [subscribeToSeason, seasonId]);

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

  // Resubscribe when seasonId changes (multi-genre support)
  // Uses subscribeToSeason directly with the new seasonId to avoid stale closure
  // FIX: Reset isSubscribingRef to prevent race condition on rapid genre switching
  useEffect(() => {
    if (enabled && mountedRef.current && currentSeasonIdRef.current !== seasonId) {
      // Unsubscribe from old channel
      unsubscribe();
      // Reset subscribing flag to allow immediate resubscription
      // This fixes race condition where rapid switching leaves user without subscription
      isSubscribingRef.current = false;
      // Subscribe to new channel with updated seasonId
      subscribeToSeason(seasonId);
    }
  }, [seasonId, enabled, unsubscribe, subscribeToSeason]);

  // Visibility-aware: disconnect when tab hidden, reconnect on visible
  // FIX: Use currentSeasonIdRef to get latest seasonId, avoiding stale closure
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (!channelRef.current && mountedRef.current) {
          // Use ref value to ensure we subscribe to current genre's channel
          // This fixes issue where genre changes while tab is hidden
          isSubscribingRef.current = false;
          subscribeToSeason(currentSeasonIdRef.current);
        }
      } else {
        unsubscribe();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, subscribeToSeason, unsubscribe]);
}
