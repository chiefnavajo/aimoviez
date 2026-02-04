// hooks/useTeamChat.ts
// Real-time team chat hook using Supabase Realtime

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';
import type { TeamMessage } from '@/types';

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'csrf-token') return value;
  }
  return null;
}

async function ensureCsrfToken(): Promise<string | null> {
  let token = getCsrfToken();
  if (token) return token;
  try {
    await fetch('/api/csrf', { credentials: 'include' });
    await new Promise(r => setTimeout(r, 100));
    token = getCsrfToken();
  } catch { /* non-fatal */ }
  return token;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ===========================
// FETCH MESSAGES
// ===========================

interface MessagesResponse {
  ok: boolean;
  messages: TeamMessage[];
  has_more: boolean;
}

export function useTeamMessages(teamId: string | null, limit: number = 50) {
  return useQuery<MessagesResponse>({
    queryKey: ['team-messages', teamId, limit],
    queryFn: async () => {
      if (!teamId) throw new Error('No team ID');
      const res = await fetch(`/api/teams/${teamId}/messages?limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch messages');
      return res.json();
    },
    enabled: !!teamId,
    staleTime: 10 * 1000, // 10 seconds
  });
}

// ===========================
// SEND MESSAGE MUTATION
// ===========================

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ teamId, message }: { teamId: string; message: string }) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = await ensureCsrfToken();
      if (token) headers['x-csrf-token'] = token;

      const res = await fetch(`/api/teams/${teamId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send message');
      return data;
    },
    onSuccess: (data, { teamId }) => {
      // Optimistically add message to cache
      queryClient.setQueryData<MessagesResponse>(
        ['team-messages', teamId, 50],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            messages: [...old.messages, data.message],
          };
        }
      );
    },
  });
}

// ===========================
// REAL-TIME CHAT HOOK
// ===========================

interface UseTeamChatOptions {
  teamId: string | null;
  enabled?: boolean;
}

export function useTeamChat({ teamId, enabled = true }: UseTeamChatOptions) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const channelRef = useRef<ReturnType<typeof createClient>['channel'] extends (name: string) => infer R ? R : never>(null);

  // Initialize Supabase client
  useEffect(() => {
    if (!supabaseRef.current) {
      supabaseRef.current = createClient(supabaseUrl, supabaseAnonKey);
    }
  }, []);

  // Subscribe to team chat channel
  useEffect(() => {
    if (!teamId || !enabled || !supabaseRef.current) {
      return;
    }

    const supabase = supabaseRef.current;
    setConnectionError(null);

    // Create channel for this team's messages
    const channel = supabase
      .channel(`team-chat:${teamId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'team_messages',
          filter: `team_id=eq.${teamId}`,
        },
        (payload) => {
          // Add new message to cache
          const newMessage = payload.new as {
            id: string;
            message: string;
            created_at: string;
            user_id: string;
            username: string;
          };

          queryClient.setQueryData<MessagesResponse>(
            ['team-messages', teamId, 50],
            (old) => {
              if (!old) return old;

              // Check if message already exists (from our own send)
              const exists = old.messages.some(m => m.id === newMessage.id);
              if (exists) return old;

              return {
                ...old,
                messages: [
                  ...old.messages,
                  {
                    id: newMessage.id,
                    message: newMessage.message,
                    created_at: newMessage.created_at,
                    user_id: newMessage.user_id,
                    username: newMessage.username,
                    avatar_url: null, // Will be fetched on next full refresh
                  },
                ],
              };
            }
          );
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
          setConnectionError(null);
        } else if (status === 'CHANNEL_ERROR') {
          setIsConnected(false);
          setConnectionError('Failed to connect to chat');
        } else if (status === 'TIMED_OUT') {
          setIsConnected(false);
          setConnectionError('Connection timed out');
        }
      });

    channelRef.current = channel;

    // Cleanup on unmount or teamId change
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setIsConnected(false);
    };
  }, [teamId, enabled, queryClient]);

  // Reconnect function
  const reconnect = useCallback(() => {
    if (!teamId || !supabaseRef.current) return;

    // Remove existing channel and re-subscribe
    if (channelRef.current) {
      supabaseRef.current.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // Trigger re-subscription by toggling enabled state
    // The effect will re-run and create a new subscription
    setConnectionError(null);
    setIsConnected(false);
  }, [teamId]);

  return {
    isConnected,
    connectionError,
    reconnect,
  };
}

// ===========================
// COMBINED HOOK FOR CONVENIENCE
// ===========================

export function useTeamChatFull(teamId: string | null) {
  const messagesQuery = useTeamMessages(teamId);
  const sendMessageMutation = useSendMessage();
  const realtimeStatus = useTeamChat({ teamId, enabled: !!teamId });

  const sendMessage = useCallback(
    async (message: string) => {
      if (!teamId) return;
      await sendMessageMutation.mutateAsync({ teamId, message });
    },
    [teamId, sendMessageMutation]
  );

  return {
    messages: messagesQuery.data?.messages ?? [],
    isLoading: messagesQuery.isLoading,
    error: messagesQuery.error,
    hasMore: messagesQuery.data?.has_more ?? false,
    refetch: messagesQuery.refetch,

    sendMessage,
    isSending: sendMessageMutation.isPending,
    sendError: sendMessageMutation.error,

    isConnected: realtimeStatus.isConnected,
    connectionError: realtimeStatus.connectionError,
    reconnect: realtimeStatus.reconnect,
  };
}
