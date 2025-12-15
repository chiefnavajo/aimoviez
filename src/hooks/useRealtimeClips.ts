// hooks/useRealtimeClips.ts
// Supabase Realtime subscription for live clip updates

import { useEffect, useRef, useCallback } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { getRealtimeClient } from '@/lib/supabase-client';

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
}

export function useRealtimeClips({
  onClipUpdate,
  onNewClip,
  onClipDelete,
  enabled = true,
}: UseRealtimeClipsOptions = {}) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isSubscribingRef = useRef(false);

  // Store callbacks in refs to avoid re-subscribing when they change
  const onClipUpdateRef = useRef(onClipUpdate);
  const onNewClipRef = useRef(onNewClip);
  const onClipDeleteRef = useRef(onClipDelete);

  // Update refs when callbacks change
  useEffect(() => {
    onClipUpdateRef.current = onClipUpdate;
    onNewClipRef.current = onNewClip;
    onClipDeleteRef.current = onClipDelete;
  }, [onClipUpdate, onNewClip, onClipDelete]);

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unsubscribe();
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

    // Subscribe to tournament_clips table changes
    const channel = client
      .channel('clips-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tournament_clips',
        },
        (payload) => {
          console.log('[Realtime] Clip UPDATE received:', payload.new);
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
        },
        (payload) => {
          if (onClipDeleteRef.current && payload.old) {
            onClipDeleteRef.current((payload.old as { id: string }).id);
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Connected to clips channel');
          channelRef.current = channel;
        } else if (status === 'CHANNEL_ERROR') {
          if (err) {
            console.error('[Realtime] Error connecting to clips channel:', err);
          }
          isSubscribingRef.current = false;
        } else if (status === 'TIMED_OUT') {
          console.error('[Realtime] Clips channel timed out');
          isSubscribingRef.current = false;
        } else if (status === 'CLOSED') {
          console.log('[Realtime] Clips channel closed');
          isSubscribingRef.current = false;
        }
      });

    return cleanup;
  }, [enabled, cleanup]);

  return { cleanup };
}

// Hook for subscribing to story slot changes (for story page)
interface UseRealtimeSlotsOptions {
  onSlotUpdate?: (slot: { id: string; status?: string; winner_tournament_clip_id?: string | null }) => void;
  enabled?: boolean;
}

export function useRealtimeSlots({
  onSlotUpdate,
  enabled = true,
}: UseRealtimeSlotsOptions = {}) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isSubscribingRef = useRef(false);
  const onSlotUpdateRef = useRef(onSlotUpdate);

  useEffect(() => {
    onSlotUpdateRef.current = onSlotUpdate;
  }, [onSlotUpdate]);

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

    const channel = client
      .channel('slots-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'story_slots',
        },
        (payload) => {
          console.log('[Realtime] Slot UPDATE received:', payload.new);
          if (payload.new && onSlotUpdateRef.current) {
            onSlotUpdateRef.current(payload.new as { id: string; status?: string; winner_tournament_clip_id?: string | null });
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Connected to slots channel');
          channelRef.current = channel;
        } else if (status === 'CHANNEL_ERROR') {
          if (err) {
            console.error('[Realtime] Error connecting to slots channel:', err);
          }
          isSubscribingRef.current = false;
        } else if (status === 'CLOSED') {
          console.log('[Realtime] Slots channel closed');
          isSubscribingRef.current = false;
        }
      });

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
      isSubscribingRef.current = false;
    };
  }, [enabled]);
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
  const clipIdsRef = useRef(clipIds);

  useEffect(() => {
    onVoteUpdateRef.current = onVoteUpdate;
    clipIdsRef.current = clipIds;
  }, [onVoteUpdate, clipIds]);

  useEffect(() => {
    if (!enabled || !onVoteUpdateRef.current) {
      return;
    }

    // Prevent duplicate subscriptions from StrictMode double-mount
    if (channelRef.current || isSubscribingRef.current) {
      return;
    }

    isSubscribingRef.current = true;

    // Use the shared singleton realtime client
    const client = getRealtimeClient();

    // Build filter if clipIds provided
    const filter = clipIdsRef.current?.length
      ? `id=in.(${clipIdsRef.current.join(',')})`
      : undefined;

    // Subscribe to vote count updates on tournament_clips
    const channel = client
      .channel('votes-realtime')
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
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Connected to votes channel');
          channelRef.current = channel;
        } else if (status === 'CLOSED') {
          console.log('[Realtime] Votes channel closed');
          isSubscribingRef.current = false;
        }
      });

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
      isSubscribingRef.current = false;
    };
  }, [enabled]);
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
}

export function useStoryBroadcast({
  onWinnerSelected,
  onSeasonReset,
  enabled = true,
}: UseStoryBroadcastOptions = {}) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isSubscribingRef = useRef(false);
  const onWinnerSelectedRef = useRef(onWinnerSelected);
  const onSeasonResetRef = useRef(onSeasonReset);

  useEffect(() => {
    onWinnerSelectedRef.current = onWinnerSelected;
    onSeasonResetRef.current = onSeasonReset;
  }, [onWinnerSelected, onSeasonReset]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Prevent duplicate subscriptions from StrictMode double-mount
    if (channelRef.current || isSubscribingRef.current) {
      return;
    }

    isSubscribingRef.current = true;

    const client = getRealtimeClient();

    // Subscribe to the broadcast channel
    const channel = client
      .channel('story-updates')
      .on('broadcast', { event: 'winner-selected' }, (payload) => {
        console.log('[Broadcast] Winner selected event received:', payload);
        if (onWinnerSelectedRef.current && payload.payload) {
          onWinnerSelectedRef.current(payload.payload as WinnerSelectedPayload);
        }
      })
      .on('broadcast', { event: 'season-reset' }, (payload) => {
        console.log('[Broadcast] Season reset event received:', payload);
        if (onSeasonResetRef.current && payload.payload) {
          onSeasonResetRef.current(payload.payload as SeasonResetPayload);
        }
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Broadcast] Connected to story-updates channel');
          channelRef.current = channel;
        } else if (status === 'CHANNEL_ERROR') {
          if (err) {
            console.error('[Broadcast] Error connecting to story-updates channel:', err);
          }
          isSubscribingRef.current = false;
        } else if (status === 'CLOSED') {
          console.log('[Broadcast] story-updates channel closed');
          isSubscribingRef.current = false;
        }
      });

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
      isSubscribingRef.current = false;
    };
  }, [enabled]);
}
