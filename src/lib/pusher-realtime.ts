// lib/pusher-config.ts
// CRITICAL FIX 4: Pusher Real-time Configuration

import Pusher from 'pusher';
import PusherClient from 'pusher-js';

// ============================================================================
// SERVER-SIDE PUSHER (for triggering events)
// ============================================================================

let pusherServer: Pusher | null = null;

export function getPusherServer(): Pusher | null {
  // Only initialize if credentials are available
  if (!process.env.PUSHER_APP_ID || 
      !process.env.PUSHER_SECRET || 
      !process.env.NEXT_PUBLIC_PUSHER_KEY || 
      !process.env.NEXT_PUBLIC_PUSHER_CLUSTER) {
    console.warn('âš ï¸ Pusher not configured. Real-time features disabled.');
    return null;
  }

  if (!pusherServer) {
    pusherServer = new Pusher({
      appId: process.env.PUSHER_APP_ID,
      key: process.env.NEXT_PUBLIC_PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
      useTLS: true,
    });
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
    console.warn('âš ï¸ Pusher not configured. Real-time features disabled.');
    return null;
  }

  if (!pusherClient) {
    pusherClient = new PusherClient(key, {
      cluster,
      forceTLS: true,
      // Enable debugging in development
      enabledTransports: ['ws', 'wss'],
      disabledTransports: [],
    });

    // Add connection event handlers
    pusherClient.connection.bind('connected', () => {
      console.log('âœ… Pusher connected');
    });

    pusherClient.connection.bind('error', (err: any) => {
      console.error('âŒ Pusher connection error:', err);
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

/**
 * Trigger vote update event
 */
export async function triggerVoteUpdate(event: VoteUpdateEvent): Promise<boolean> {
  const pusher = getPusherServer();
  if (!pusher) return false;

  try {
    await pusher.trigger(PUSHER_CHANNELS.VOTING, 'vote-update', event);
    return true;
  } catch (error) {
    console.error('Failed to trigger vote update:', error);
    return false;
  }
}

/**
 * Trigger slot status change
 */
export async function triggerSlotUpdate(event: SlotUpdateEvent): Promise<boolean> {
  const pusher = getPusherServer();
  if (!pusher) return false;

  try {
    await pusher.trigger(PUSHER_CHANNELS.SLOTS, 'slot-update', event);
    return true;
  } catch (error) {
    console.error('Failed to trigger slot update:', error);
    return false;
  }
}

/**
 * Send notification to specific user
 */
export async function triggerNotification(event: NotificationEvent): Promise<boolean> {
  const pusher = getPusherServer();
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

// ============================================================================
// REACT HOOK FOR REAL-TIME UPDATES
// ============================================================================

/*
USAGE IN REACT COMPONENTS:

import { usePusher } from '@/lib/hooks/usePusher';

export function VotingArena() {
  const { subscribe, unsubscribe } = usePusher();
  
  useEffect(() => {
    // Subscribe to vote updates
    const channel = subscribe('voting-track-main', {
      'vote-update': (data: VoteUpdateEvent) => {
        // Update local state or refetch
        console.log('Vote update:', data);
      },
    });
    
    // Cleanup
    return () => {
      unsubscribe('voting-track-main');
    };
  }, []);
}
*/

// ============================================================================
// SETUP INSTRUCTIONS
// ============================================================================

/*
PUSHER SETUP GUIDE (5 minutes):

1. CREATE PUSHER ACCOUNT
========================
- Go to: https://dashboard.pusher.com
- Sign up for free account
- Click "Create app"

2. CONFIGURE APP
================
- Name: aimoviez
- Cluster: us2 (or closest to your users)
- Frontend: React
- Backend: Node.js
- Click "Create app"

3. GET CREDENTIALS
==================
- Go to "App Keys" tab
- Copy all 4 values

4. ADD TO .env.local
====================
NEXT_PUBLIC_PUSHER_KEY=your-key-from-dashboard
NEXT_PUBLIC_PUSHER_CLUSTER=us2
PUSHER_APP_ID=your-app-id
PUSHER_SECRET=your-secret

5. INSTALL PACKAGES
===================
npm install pusher pusher-js

6. CREATE HOOK FILE
===================
Create: lib/hooks/usePusher.tsx
*/

// lib/hooks/usePusher.tsx
export const USE_PUSHER_HOOK = `
import { useEffect, useRef, useCallback } from 'react';
import { getPusherClient } from '@/lib/pusher-config';
import type { Channel } from 'pusher-js';

export function usePusher() {
  const channelsRef = useRef<Map<string, Channel>>(new Map());

  const subscribe = useCallback((
    channelName: string,
    events: Record<string, (data: any) => void>
  ): Channel | null => {
    const pusher = getPusherClient();
    if (!pusher) return null;

    // Check if already subscribed
    if (channelsRef.current.has(channelName)) {
      const channel = channelsRef.current.get(channelName)!;
      
      // Bind new events
      Object.entries(events).forEach(([event, handler]) => {
        channel.bind(event, handler);
      });
      
      return channel;
    }

    // Subscribe to new channel
    const channel = pusher.subscribe(channelName);
    
    // Bind events
    Object.entries(events).forEach(([event, handler]) => {
      channel.bind(event, handler);
    });
    
    // Store reference
    channelsRef.current.set(channelName, channel);
    
    return channel;
  }, []);

  const unsubscribe = useCallback((channelName: string) => {
    const pusher = getPusherClient();
    if (!pusher) return;

    const channel = channelsRef.current.get(channelName);
    if (channel) {
      pusher.unsubscribe(channelName);
      channelsRef.current.delete(channelName);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const pusher = getPusherClient();
      if (pusher) {
        // Unsubscribe from all channels
        channelsRef.current.forEach((_, channelName) => {
          pusher.unsubscribe(channelName);
        });
        channelsRef.current.clear();
      }
    };
  }, []);

  return { subscribe, unsubscribe };
}
`;

// ============================================================================
// UPDATED VOTE API WITH PUSHER
// ============================================================================

export const UPDATED_VOTE_POST = `
// Add this to your /api/vote POST endpoint after successful vote:

import { triggerVoteUpdate } from '@/lib/pusher-config';

// After updating clip stats in database...
await triggerVoteUpdate({
  clipId,
  newVoteCount,
  newWeightedScore,
  newHypeScore,
  voterId: voterKey,
});
`;

// ============================================================================
// TEST PUSHER CONNECTION
// ============================================================================

export const TEST_PUSHER_SCRIPT = `
// test-pusher.js
// Run: node test-pusher.js

const Pusher = require('pusher');

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.NEXT_PUBLIC_PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
  useTLS: true,
});

// Test trigger
pusher.trigger('test-channel', 'test-event', {
  message: 'Hello from Pusher!',
  timestamp: new Date().toISOString(),
})
.then(() => {
  console.log('âœ… Pusher test successful!');
  process.exit(0);
})
.catch((error) => {
  console.error('âŒ Pusher test failed:', error);
  process.exit(1);
});
`;

// ============================================================================
// FALLBACK FOR NO PUSHER
// ============================================================================

/**
 * Polling fallback if Pusher is not configured
 * Use this in your React components as a fallback
 */
export const POLLING_FALLBACK = `
// Use polling if Pusher is not available
import { useQuery } from '@tanstack/react-query';

function useRealTimeVotes(clipId: string, pusherEnabled: boolean) {
  // Use Pusher if available
  if (pusherEnabled) {
    // ... Pusher subscription code
  }
  
  // Fallback to polling
  return useQuery({
    queryKey: ['clip-votes', clipId],
    queryFn: async () => {
      const res = await fetch(\`/api/clips/\${clipId}/votes\`);
      return res.json();
    },
    refetchInterval: pusherEnabled ? false : 5000, // Poll every 5 seconds
    staleTime: pusherEnabled ? Infinity : 4000,
  });
}
`;