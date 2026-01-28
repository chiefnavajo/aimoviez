// hooks/useRealtimeComments.ts
// ============================================================================
// REAL-TIME COMMENTS BROADCAST HOOK
// Subscribes to Supabase Broadcast 'comments:{clipId}' channel for live
// comment updates. Resubscribes when clipId changes.
// ============================================================================

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { getRealtimeClient } from '@/lib/supabase-client';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface NewCommentPayload {
  clipId: string;
  id: string;
  username: string;
  avatarUrl: string;
  commentText: string;
  parentCommentId?: string;
  timestamp: number;
}

export interface CommentLikedPayload {
  clipId: string;
  commentId: string;
  likesCount: number;
  timestamp: number;
}

export interface CommentDeletedPayload {
  clipId: string;
  commentId: string;
  timestamp: number;
}

interface UseRealtimeCommentsOptions {
  onNewComment?: (payload: NewCommentPayload) => void;
  onCommentLiked?: (payload: CommentLikedPayload) => void;
  onCommentDeleted?: (payload: CommentDeletedPayload) => void;
  enabled?: boolean;
}

// ============================================================================
// HOOK
// ============================================================================

export function useRealtimeComments(
  clipId: string | null,
  {
    onNewComment,
    onCommentLiked,
    onCommentDeleted,
    enabled = true,
  }: UseRealtimeCommentsOptions = {}
) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isSubscribingRef = useRef(false);
  const mountedRef = useRef(true);

  // Keep callback refs fresh
  const onNewCommentRef = useRef(onNewComment);
  const onCommentLikedRef = useRef(onCommentLiked);
  const onCommentDeletedRef = useRef(onCommentDeleted);

  useEffect(() => {
    onNewCommentRef.current = onNewComment;
    onCommentLikedRef.current = onCommentLiked;
    onCommentDeletedRef.current = onCommentDeleted;
  }, [onNewComment, onCommentLiked, onCommentDeleted]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      const client = getRealtimeClient();
      client.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    isSubscribingRef.current = false;
  }, []);

  const subscribe = useCallback((id: string) => {
    if (!mountedRef.current || !enabled) return;
    if (isSubscribingRef.current) return;

    // Unsubscribe from any previous channel
    unsubscribe();

    isSubscribingRef.current = true;

    try {
      const client = getRealtimeClient();
      const channelName = `comments:${id}`;

      const channel = client
        .channel(channelName)
        .on('broadcast', { event: 'new-comment' }, (payload) => {
          if (onNewCommentRef.current && payload.payload) {
            onNewCommentRef.current(payload.payload as NewCommentPayload);
          }
        })
        .on('broadcast', { event: 'comment-liked' }, (payload) => {
          if (onCommentLikedRef.current && payload.payload) {
            onCommentLikedRef.current(payload.payload as CommentLikedPayload);
          }
        })
        .on('broadcast', { event: 'comment-deleted' }, (payload) => {
          if (onCommentDeletedRef.current && payload.payload) {
            onCommentDeletedRef.current(payload.payload as CommentDeletedPayload);
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channelRef.current = channel;
            isSubscribingRef.current = false;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[RealtimeComments] Subscription failed:', status);
            isSubscribingRef.current = false;
          }
        });
    } catch {
      isSubscribingRef.current = false;
    }
  }, [enabled, unsubscribe]);

  // Subscribe when clipId changes
  useEffect(() => {
    mountedRef.current = true;

    if (enabled && clipId) {
      subscribe(clipId);
    } else {
      unsubscribe();
    }

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [clipId, enabled, subscribe, unsubscribe]);
}
