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

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unsubscribe();
      channelRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

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
          if (onClipUpdate && payload.new) {
            onClipUpdate(payload.new as ClipUpdate);
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
          if (onNewClip && payload.new) {
            onNewClip(payload.new as ClipUpdate);
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
          if (onClipDelete && payload.old) {
            onClipDelete((payload.old as { id: string }).id);
          }
        }
      )
      .subscribe((status, err) => {
        console.log('[Realtime] Clips channel status:', status, err);
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Connected to clips channel');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime] Error connecting to clips channel:', err);
        } else if (status === 'TIMED_OUT') {
          console.error('[Realtime] Clips channel timed out');
        } else if (status === 'CLOSED') {
          console.error('[Realtime] Clips channel closed');
        }
      });

    channelRef.current = channel;

    return cleanup;
  }, [enabled, onClipUpdate, onNewClip, onClipDelete, cleanup]);

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

  useEffect(() => {
    if (!enabled || !onSlotUpdate) {
      return;
    }

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
          if (payload.new) {
            onSlotUpdate(payload.new as { id: string; status?: string; winner_tournament_clip_id?: string | null });
          }
        }
      )
      .subscribe((status, err) => {
        console.log('[Realtime] Slots channel status:', status, err);
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Connected to slots channel');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime] Error connecting to slots channel:', err);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [enabled, onSlotUpdate]);
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

  useEffect(() => {
    if (!enabled || !onVoteUpdate) {
      return;
    }

    // Use the shared singleton realtime client
    const client = getRealtimeClient();

    // Build filter if clipIds provided
    const filter = clipIds?.length
      ? `id=in.(${clipIds.join(',')})`
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
          if (newData?.id) {
            onVoteUpdate(newData.id, newData.vote_count || 0, newData.weighted_score || 0);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Connected to votes channel');
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [enabled, clipIds, onVoteUpdate]);
}
