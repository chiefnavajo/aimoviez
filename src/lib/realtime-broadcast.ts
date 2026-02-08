// lib/realtime-broadcast.ts
// ============================================================================
// REAL-TIME BROADCAST
// Server-side Supabase Broadcast helpers. Fire-and-forget from API routes.
// Sends events to Supabase Realtime channels for live client updates.
// All functions are no-ops when realtime_broadcast flag is disabled.
// ============================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CHANNELS = {
  VOTES: 'votes',
  VOTES_BY_SEASON: (seasonId: string) => `votes:season:${seasonId}`,
  COMMENTS: (clipId: string) => `comments:${clipId}`,
  LEADERBOARD: 'leaderboard',
} as const;

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  supabase = createClient(url, key, {
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });
  return supabase;
}

// ============================================================================
// BROADCAST HELPERS
// ============================================================================

/**
 * Broadcast a vote count update to connected clients.
 * Multi-genre: When seasonId is provided, broadcasts to season-specific channel.
 * Fire-and-forget — never throws.
 */
export async function broadcastVoteUpdate(
  clipId: string,
  voteCount: number,
  weightedScore: number,
  seasonId?: string
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  try {
    // Use season-specific channel if seasonId provided, otherwise global channel
    const channelName = seasonId ? CHANNELS.VOTES_BY_SEASON(seasonId) : CHANNELS.VOTES;
    const channel = sb.channel(channelName);
    await channel.httpSend('vote-update', {
      clipId,
      voteCount,
      weightedScore,
      seasonId,
      timestamp: Date.now(),
    });
    sb.removeChannel(channel);

    // Also broadcast to global channel for backwards compatibility
    if (seasonId) {
      const globalChannel = sb.channel(CHANNELS.VOTES);
      await globalChannel.httpSend('vote-update', {
        clipId,
        voteCount,
        weightedScore,
        seasonId,
        timestamp: Date.now(),
      });
      sb.removeChannel(globalChannel);
    }
  } catch (err) {
    console.warn('[Broadcast] Vote update failed (non-fatal):', err);
  }
}

/**
 * Broadcast a comment event to clients viewing a specific clip.
 * Fire-and-forget — never throws.
 */
export async function broadcastCommentEvent(
  clipId: string,
  event: 'new-comment' | 'comment-liked' | 'comment-deleted',
  data: Record<string, unknown>
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  try {
    const channel = sb.channel(CHANNELS.COMMENTS(clipId));
    await channel.httpSend(event, {
      clipId,
      ...data,
      timestamp: Date.now(),
    });
    sb.removeChannel(channel);
  } catch (err) {
    console.warn('[Broadcast] Comment event failed (non-fatal):', err);
  }
}

/**
 * Broadcast a leaderboard refresh signal to all connected clients.
 * Fire-and-forget — never throws.
 */
export async function broadcastLeaderboardUpdate(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  try {
    const channel = sb.channel(CHANNELS.LEADERBOARD);
    await channel.httpSend('refresh', {
      timestamp: Date.now(),
    });
    sb.removeChannel(channel);
  } catch (err) {
    console.warn('[Broadcast] Leaderboard update failed (non-fatal):', err);
  }
}
