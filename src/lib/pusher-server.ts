// lib/pusher-server.ts
// ============================================================================
// PUSHER SERVER SDK - For broadcasting real-time events
// ============================================================================

import Pusher from 'pusher';

// Singleton instance
let pusherInstance: Pusher | null = null;

/**
 * Get Pusher server instance (singleton)
 * Returns null if Pusher is not configured
 */
export function getPusherServer(): Pusher | null {
  // Check if already initialized
  if (pusherInstance) {
    return pusherInstance;
  }

  // Check for required env vars
  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.PUSHER_KEY || process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.PUSHER_CLUSTER || process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!appId || !key || !secret || !cluster) {
    // Pusher not configured - return null (graceful degradation)
    return null;
  }

  // Initialize Pusher
  pusherInstance = new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  });

  return pusherInstance;
}

/**
 * Broadcast a vote update to all connected clients
 */
export async function broadcastVoteUpdate(clipId: string, voteCount: number): Promise<void> {
  const pusher = getPusherServer();

  if (!pusher) {
    // Pusher not configured - silently skip
    return;
  }

  try {
    await pusher.trigger('voting-track-main', 'vote-update', {
      clipId,
      voteCount,
    });
  } catch (error) {
    // Don't fail the vote if broadcasting fails
    console.warn('[Pusher] Failed to broadcast vote update:', error);
  }
}

/**
 * Broadcast slot change (when advancing to next slot)
 */
export async function broadcastSlotChange(slotPosition: number): Promise<void> {
  const pusher = getPusherServer();

  if (!pusher) {
    return;
  }

  try {
    await pusher.trigger('voting-track-main', 'slot-change', {
      slotPosition,
    });
  } catch (error) {
    console.warn('[Pusher] Failed to broadcast slot change:', error);
  }
}
