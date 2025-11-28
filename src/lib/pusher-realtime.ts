// lib/pusher-realtime.ts
// Pusher Real-time Configuration (optional feature)

import PusherClient from 'pusher-js';

// ============================================================================
// SERVER-SIDE PUSHER (for triggering events)
// ============================================================================

// Note: Server-side Pusher requires 'pusher' package (npm install pusher)
// It's optional - if not installed, real-time triggers will be disabled

let pusherServer: any = null;

export async function getPusherServer(): Promise<any | null> {
  // Only initialize if credentials are available
  if (!process.env.PUSHER_APP_ID || 
      !process.env.PUSHER_SECRET || 
      !process.env.NEXT_PUBLIC_PUSHER_KEY || 
      !process.env.NEXT_PUBLIC_PUSHER_CLUSTER) {
    return null;
  }

  if (!pusherServer) {
    try {
      const Pusher = (await import('pusher')).default;
      pusherServer = new Pusher({
        appId: process.env.PUSHER_APP_ID,
        key: process.env.NEXT_PUBLIC_PUSHER_KEY,
        secret: process.env.PUSHER_SECRET,
        cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
        useTLS: true,
      });
    } catch {
      // Pusher package not installed - that's OK
      return null;
    }
  }

  return pusherServer;
}

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
// SERVER-SIDE TRIGGER FUNCTIONS
// ============================================================================

export async function triggerVoteUpdate(event: VoteUpdateEvent): Promise<boolean> {
  const pusher = await getPusherServer();
  if (!pusher) return false;

  try {
    await pusher.trigger(PUSHER_CHANNELS.VOTING, 'vote-update', event);
    return true;
  } catch (error) {
    console.error('Failed to trigger vote update:', error);
    return false;
  }
}

export async function triggerSlotUpdate(event: SlotUpdateEvent): Promise<boolean> {
  const pusher = await getPusherServer();
  if (!pusher) return false;

  try {
    await pusher.trigger(PUSHER_CHANNELS.SLOTS, 'slot-update', event);
    return true;
  } catch (error) {
    console.error('Failed to trigger slot update:', error);
    return false;
  }
}

export async function triggerNotification(event: NotificationEvent): Promise<boolean> {
  const pusher = await getPusherServer();
  if (!pusher) return false;

  try {
    await pusher.trigger(
      PUSHER_CHANNELS.NOTIFICATIONS(event.userId),
      'new-notification',
      event
    );
    return true;
  } catch (error) {
    console.error('Failed to trigger notification:', error);
    return false;
  }
}
