// lib/pusher-realtime.ts
// Pusher Real-time Configuration (client-side only)

import PusherClient from 'pusher-js';

// ============================================================================
// CLIENT-SIDE PUSHER (for React components)
// ============================================================================

let pusherClient: PusherClient | null = null;

export function getPusherClient(): PusherClient | null {
  // Check if we're on client side
  if (typeof window === 'undefined') {
    return null;
  }

  // Check if Pusher is configured
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

  if (!key || !cluster) {
    return null;
  }

  if (!pusherClient) {
    pusherClient = new PusherClient(key, {
      cluster,
      forceTLS: true,
      enabledTransports: ['ws', 'wss'],
      disabledTransports: [],
    });

    pusherClient.connection.bind('connected', () => {
      console.log('Pusher connected');
    });

    pusherClient.connection.bind('error', (err: any) => {
      console.error('Pusher connection error:', err);
    });
  }

  return pusherClient;
}

// ============================================================================
// SERVER-SIDE PUSHER STUB
// ============================================================================
// To enable server-side Pusher triggers, run: npm install pusher
// Then implement getPusherServer() with the 'pusher' package

export async function getPusherServer(): Promise<null> {
  // Server-side Pusher not configured
  // Install 'pusher' package and configure to enable
  return null;
}

// ============================================================================
// REAL-TIME EVENT TYPES
// ============================================================================

export interface VoteUpdateEvent {
  clipId: string;
  newVoteCount: number;
  newWeightedScore: number;
  newHypeScore: number;
  voterId?: string;
}

export interface SlotUpdateEvent {
  slotId: number;
  status: 'upcoming' | 'voting' | 'locked';
  winningClipId?: string;
}

export interface NotificationEvent {
  userId: string;
  type: string;
  message: string;
  data?: any;
}

// ============================================================================
// CHANNEL NAMES
// ============================================================================

export const PUSHER_CHANNELS = {
  VOTING: 'voting-track-main',
  SLOTS: 'slots-updates',
  NOTIFICATIONS: (userId: string) => `notifications-${userId}`,
  ADMIN: 'admin-updates',
  GLOBAL: 'global-updates',
} as const;

// ============================================================================
// SERVER-SIDE TRIGGER FUNCTIONS (stubs - returns false when not configured)
// ============================================================================

export async function triggerVoteUpdate(_event: VoteUpdateEvent): Promise<boolean> {
  // Server-side Pusher not configured
  return false;
}

export async function triggerSlotUpdate(_event: SlotUpdateEvent): Promise<boolean> {
  // Server-side Pusher not configured
  return false;
}

export async function triggerNotification(_event: NotificationEvent): Promise<boolean> {
  // Server-side Pusher not configured
  return false;
}
