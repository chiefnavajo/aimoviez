// hooks/useRealtimeClips.ts
// Supabase Realtime subscription for live clip updates

import { useEffect, useRef, useCallback } from 'react';
import { createClient, RealtimeChannel } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface ClipUpdate {
  id: string;
  vote_count?: number;
  weighted_score?: number;
  hype_score?: number;
  status?: string;
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
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null);

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unsubscribe();
      channelRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !supabaseUrl || !supabaseAnonKey) {
      return;
    }

    // Create a dedicated client for realtime
    if (!clientRef.current) {
      clientRef.current = createClient(supabaseUrl, supabaseAnonKey, {
        realtime: {
          params: {
            eventsPerSecond: 10,
          },
        },
      });
    }

    const client = clientRef.current;

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
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Connected to clips channel');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime] Error connecting to clips channel');
        }
      });

    channelRef.current = channel;

    return cleanup;
  }, [enabled, onClipUpdate, onNewClip, onClipDelete, cleanup]);

  return { cleanup };
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
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null);

  useEffect(() => {
    if (!enabled || !supabaseUrl || !supabaseAnonKey || !onVoteUpdate) {
      return;
    }

    // Create a dedicated client for realtime
    if (!clientRef.current) {
      clientRef.current = createClient(supabaseUrl, supabaseAnonKey, {
        realtime: {
          params: {
            eventsPerSecond: 10,
          },
        },
      });
    }

    const client = clientRef.current;

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
