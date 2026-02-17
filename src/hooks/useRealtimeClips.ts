// hooks/useRealtimeClips.ts
// Supabase Realtime subscription for live clip updates

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { getRealtimeClient } from '@/lib/supabase-client';

const isDev = process.env.NODE_ENV === 'development';

export interface ClipUpdate {
  id: string;
  vote_count?: number;
  weighted_score?: number;
  hype_score?: number;
  status?: string;
  slot_position?: number;
  is_winner?: boolean;
  [key: string]: unknown;
}

interface UseRealtimeClipsOptions {
  onClipUpdate?: (clip: ClipUpdate) => void;
  onNewClip?: (clip: ClipUpdate) => void;
  onClipDelete?: (clipId: string) => void;
  enabled?: boolean;
  seasonId?: string; // Filter updates to specific season
}

export function useRealtimeClips({
  onClipUpdate,
  onNewClip,
  onClipDelete,
  enabled = true,
  seasonId,
}: UseRealtimeClipsOptions = {}) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isSubscribingRef = useRef(false);

  // Store callbacks in refs to avoid re-subscribing when they change
  const onClipUpdateRef = useRef(onClipUpdate);
  const onNewClipRef = useRef(onNewClip);
  const onClipDeleteRef = useRef(onClipDelete);
  const seasonIdRef = useRef(seasonId);

  // Update refs when callbacks change
  useEffect(() => {
    onClipUpdateRef.current = onClipUpdate;
    onNewClipRef.current = onNewClip;
    onClipDeleteRef.current = onClipDelete;
    seasonIdRef.current = seasonId;
  }, [onClipUpdate, onNewClip, onClipDelete, seasonId]);

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      const client = getRealtimeClient();
      client.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    isSubscribingRef.current = false;
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Prevent duplicate subscriptions from StrictMode double-mount
    if (channelRef.current || isSubscribingRef.current) {
      return;
    }

    isSubscribingRef.current = true;

    // Use the shared singleton realtime client
    const client = getRealtimeClient();

    // Build season filter if seasonId provided
    const seasonFilter = seasonIdRef.current ? `season_id=eq.${seasonIdRef.current}` : undefined;
    const channelName = seasonIdRef.current ? `clips-realtime-${seasonIdRef.current}` : 'clips-realtime';

    // Subscribe to tournament_clips table changes
    const channel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tournament_clips',
          filter: seasonFilter,
        },
        (payload) => {
          if (isDev) console.log('[Realtime] Clip UPDATE received');
          if (onClipUpdateRef.current && payload.new) {
            onClipUpdateRef.current(payload.new as ClipUpdate);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tournament_clips',
          filter: seasonFilter,
        },
        (payload) => {
          if (onNewClipRef.current && payload.new) {
            onNewClipRef.current(payload.new as ClipUpdate);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'tournament_clips',
          filter: seasonFilter,
        },
        (payload) => {
          if (onClipDeleteRef.current && payload.old) {
            onClipDeleteRef.current((payload.old as { id: string }).id);
          }
        }
      )
    channelRef.current = channel; // Set BEFORE subscribing
    channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          if (isDev) console.log('[Realtime] Connected to clips channel');
        } else if (status === 'CHANNEL_ERROR') {
          if (err) {
            console.error('[Realtime] Error connecting to clips channel:', err);
          }
          channelRef.current = null;
          isSubscribingRef.current = false;
        } else if (status === 'TIMED_OUT') {
          console.error('[Realtime] Clips channel timed out');
          channelRef.current = null;
          isSubscribingRef.current = false;
        } else if (status === 'CLOSED') {
          if (isDev) console.log('[Realtime] Clips channel closed');
          channelRef.current = null;
          isSubscribingRef.current = false;
        }
      });

    return cleanup;
  }, [enabled, cleanup, seasonId]);

  return { cleanup };
}

// Hook for subscribing to story slot changes (for story page)
interface UseRealtimeSlotsOptions {
  onSlotUpdate?: (slot: { id: string; status?: string; winner_tournament_clip_id?: string | null }) => void;
  enabled?: boolean;
  seasonId?: string; // Filter updates to specific season
}

export function useRealtimeSlots({
  onSlotUpdate,
  enabled = true,
  seasonId,
}: UseRealtimeSlotsOptions = {}) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isSubscribingRef = useRef(false);
  const onSlotUpdateRef = useRef(onSlotUpdate);
  const seasonIdRef = useRef(seasonId);

  useEffect(() => {
    onSlotUpdateRef.current = onSlotUpdate;
    seasonIdRef.current = seasonId;
  }, [onSlotUpdate, seasonId]);

  useEffect(() => {
    if (!enabled || !onSlotUpdateRef.current) {
      return;
    }

    // Prevent duplicate subscriptions from StrictMode double-mount
    if (channelRef.current || isSubscribingRef.current) {
      return;
    }

    isSubscribingRef.current = true;

    const client = getRealtimeClient();

    // Build season filter if seasonId provided — use seasonId directly (not ref) to avoid stale values
    const seasonFilter = seasonId ? `season_id=eq.${seasonId}` : undefined;
    const channelName = seasonId ? `slots-realtime-${seasonId}` : 'slots-realtime';

    const channel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'story_slots',
          filter: seasonFilter,
        },
        (payload) => {
          if (isDev) console.log('[Realtime] Slot UPDATE received');
          if (payload.new && onSlotUpdateRef.current) {
            onSlotUpdateRef.current(payload.new as { id: string; status?: string; winner_tournament_clip_id?: string | null });
          }
        }
      );

    channelRef.current = channel; // Set BEFORE subscribing
    channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          if (isDev) console.log('[Realtime] Connected to slots channel');
        } else if (status === 'CHANNEL_ERROR') {
          if (err) {
            console.error('[Realtime] Error connecting to slots channel:', err);
          }
          channelRef.current = null;
          isSubscribingRef.current = false;
        } else if (status === 'CLOSED') {
          if (isDev) console.log('[Realtime] Slots channel closed');
          channelRef.current = null;
          isSubscribingRef.current = false;
        }
      });

    return () => {
      if (channelRef.current) {
        client.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      isSubscribingRef.current = false;
    };
  }, [enabled, seasonId]);
}

// Hook for subscribing to vote updates specifically
interface UseRealtimeVotesOptions {
  clipIds?: string[];
  onVoteUpdate?: (clipId: string, newVoteCount: number, weightedScore: number) => void;
  enabled?: boolean;
}

export function useRealtimeVotes({
  clipIds,
  onVoteUpdate,
  enabled = true,
}: UseRealtimeVotesOptions = {}) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isSubscribingRef = useRef(false);
  const onVoteUpdateRef = useRef(onVoteUpdate);

  // HS-2: Serialize clipIds so changes trigger resubscription
  const clipIdsKey = useMemo(() => (clipIds ?? []).join(','), [clipIds]);

  useEffect(() => {
    onVoteUpdateRef.current = onVoteUpdate;
  }, [onVoteUpdate]);

  useEffect(() => {
    if (!enabled || !onVoteUpdateRef.current) {
      return;
    }

    // Use the shared singleton realtime client
    const client = getRealtimeClient();

    // HS-2: Clean up old channel when clipIds change (don't early-return)
    if (channelRef.current) {
      client.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    isSubscribingRef.current = true;

    // Build filter if clipIds provided — use clipIds directly
    const filter = clipIds?.length
      ? `id=in.(${clipIds.join(',')})`
      : undefined;

    // Subscribe to vote count updates on tournament_clips
    const channel = client
      .channel(`votes-realtime-${clipIdsKey || 'all'}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tournament_clips',
          filter,
        },
        (payload) => {
          const newData = payload.new as {
            id: string;
            vote_count: number;
            weighted_score: number;
          };
          if (newData?.id && onVoteUpdateRef.current) {
            onVoteUpdateRef.current(newData.id, newData.vote_count || 0, newData.weighted_score || 0);
          }
        }
      );

    channelRef.current = channel; // Set BEFORE subscribing
    channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (isDev) console.log('[Realtime] Connected to votes channel');
        } else if (status === 'CLOSED') {
          if (isDev) console.log('[Realtime] Votes channel closed');
          channelRef.current = null;
          isSubscribingRef.current = false;
        }
      });

    return () => {
      if (channelRef.current) {
        client.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      isSubscribingRef.current = false;
    };
  }, [enabled, clipIdsKey, clipIds]);
}

// Hook for subscribing to story broadcasts (more reliable than postgres_changes)
// The admin API broadcasts when a winner is selected or season is reset
export interface WinnerSelectedPayload {
  slotId: string;
  slotPosition: number;
  clipId: string;
  seasonId: string;
  timestamp: string;
}

export interface SeasonResetPayload {
  seasonId: string;
  startSlot: number;
  timestamp: string;
}

interface UseStoryBroadcastOptions {
  onWinnerSelected?: (payload: WinnerSelectedPayload) => void;
  onSeasonReset?: (payload: SeasonResetPayload) => void;
  enabled?: boolean;
  seasonId?: string; // Filter events to specific season
}

export function useStoryBroadcast({
  onWinnerSelected,
  onSeasonReset,
  enabled = true,
  seasonId,
}: UseStoryBroadcastOptions = {}) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isSubscribingRef = useRef(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const onWinnerSelectedRef = useRef(onWinnerSelected);
  const onSeasonResetRef = useRef(onSeasonReset);
  const seasonIdRef = useRef(seasonId);

  // Max reconnect attempts before giving up (will rely on polling fallback)
  const MAX_RECONNECT_ATTEMPTS = 5;
  const BASE_RECONNECT_DELAY = 1000; // 1 second

  useEffect(() => {
    onWinnerSelectedRef.current = onWinnerSelected;
    onSeasonResetRef.current = onSeasonReset;
    seasonIdRef.current = seasonId;
  }, [onWinnerSelected, onSeasonReset, seasonId]);

  // HS-1: Use a ref for subscribe to break circular dependency with scheduleReconnect
  const subscribeRef = useRef<() => void>(() => {});

  // Subscribe function that can be called for initial connection and reconnection
  const subscribe = useCallback(() => {
    if (!mountedRef.current || !enabled) {
      return;
    }

    // Prevent duplicate subscriptions
    if (channelRef.current || isSubscribingRef.current) {
      return;
    }

    isSubscribingRef.current = true;
    const client = getRealtimeClient();

    if (isDev) console.log('[Broadcast] Attempting to connect to story-updates channel...');

    // Subscribe to the broadcast channel
    const channel = client
      .channel('story-updates')
      .on('broadcast', { event: 'winner-selected' }, (payload) => {
        if (isDev) console.log('[Broadcast] Winner selected event received');
        if (onWinnerSelectedRef.current && payload.payload) {
          const data = payload.payload as WinnerSelectedPayload;
          // Filter by season if seasonId is specified
          if (seasonIdRef.current && data.seasonId !== seasonIdRef.current) {
            if (isDev) console.log('[Broadcast] Ignoring winner-selected for different season');
            return;
          }
          onWinnerSelectedRef.current(data);
        }
      })
      .on('broadcast', { event: 'season-reset' }, (payload) => {
        if (isDev) console.log('[Broadcast] Season reset event received');
        if (onSeasonResetRef.current && payload.payload) {
          const data = payload.payload as SeasonResetPayload;
          // Filter by season if seasonId is specified
          if (seasonIdRef.current && data.seasonId !== seasonIdRef.current) {
            if (isDev) console.log('[Broadcast] Ignoring season-reset for different season');
            return;
          }
          onSeasonResetRef.current(data);
        }
      });

    channelRef.current = channel; // Set BEFORE subscribing
    channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          if (isDev) console.log('[Broadcast] Connected to story-updates channel');
          isSubscribingRef.current = false;
          reconnectAttemptsRef.current = 0; // Reset on successful connection
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Broadcast] Channel error:', err?.message || 'unknown');
          isSubscribingRef.current = false;
          channelRef.current = null;
          scheduleReconnect();
        } else if (status === 'CLOSED') {
          if (isDev) console.log('[Broadcast] Channel closed');
          isSubscribingRef.current = false;
          channelRef.current = null;
          scheduleReconnect();
        } else if (status === 'TIMED_OUT') {
          console.warn('[Broadcast] Connection timed out');
          isSubscribingRef.current = false;
          channelRef.current = null;
          scheduleReconnect();
        }
      });
  }, [enabled]);

  // Keep subscribeRef in sync with latest subscribe
  useEffect(() => { subscribeRef.current = subscribe; }, [subscribe]);

  // Schedule a reconnection attempt with exponential backoff
  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current || !enabled) {
      return;
    }

    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[Broadcast] Max reconnection attempts reached, relying on polling fallback');
      return;
    }

    // Clear any existing reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current);
    reconnectAttemptsRef.current += 1;

    if (isDev) console.log(`[Broadcast] Scheduling reconnect attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);

    reconnectTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        subscribeRef.current(); // HS-1: Always calls latest subscribe via ref
      }
    }, delay);
  }, [enabled]); // HS-1: Remove subscribe from deps — uses ref instead

  // Initial subscription
  useEffect(() => {
    mountedRef.current = true;

    if (enabled) {
      subscribe();
    }

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (channelRef.current) {
        const client = getRealtimeClient();
        client.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      isSubscribingRef.current = false;
    };
  }, [enabled, subscribe]);

  // Handle visibility change - reconnect when tab becomes visible
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (isDev) console.log('[Broadcast] Tab became visible, checking connection...');
        // If not connected, try to reconnect
        if (!channelRef.current && !isSubscribingRef.current) {
          reconnectAttemptsRef.current = 0; // Reset attempts on visibility change
          subscribe();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, subscribe]);
}
