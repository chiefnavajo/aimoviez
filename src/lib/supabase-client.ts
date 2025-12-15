// lib/supabase-client.ts
// Centralized Supabase client management
//
// SECURITY GUIDELINES:
//
// 1. Use getAnonClient() for:
//    - Read operations on public data (leaderboards, public clips, etc.)
//    - Operations that respect RLS (Row Level Security)
//    - Client-side operations
//
// 2. Use getServiceClient() ONLY for:
//    - Admin operations that need to bypass RLS
//    - User creation/management
//    - Vote recording (needs to write to multiple tables atomically)
//    - Operations explicitly requiring elevated privileges
//
// 3. NEVER expose service role key to client code
// 4. ALWAYS validate user input before database operations
// 5. Use parameterized queries (Supabase handles this automatically)

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Singleton clients
let anonClient: SupabaseClient | null = null;
let serviceClient: SupabaseClient | null = null;
let realtimeClient: SupabaseClient | null = null;

/**
 * Get the anonymous Supabase client
 * Use this for read operations and operations that should respect RLS
 */
export function getAnonClient(): SupabaseClient {
  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
  }
  if (!supabaseAnonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable');
  }

  if (!anonClient) {
    anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return anonClient;
}

/**
 * Get the service role Supabase client
 * SECURITY: Only use this for operations that REQUIRE bypassing RLS
 *
 * Valid use cases:
 * - Creating users
 * - Recording votes (writes to multiple tables)
 * - Admin operations
 * - Cron jobs / background tasks
 */
export function getServiceClient(): SupabaseClient {
  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
  }
  if (!supabaseServiceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  }

  if (!serviceClient) {
    serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return serviceClient;
}

/**
 * Create a fresh service client (not singleton)
 * Use when you need isolated transactions or testing
 */
export function createServiceClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Create a fresh anon client (not singleton)
 * Use when you need isolated operations
 */
export function createAnonClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Get the singleton realtime Supabase client
 * Use this for realtime subscriptions to avoid multiple GoTrueClient instances
 */
export function getRealtimeClient(): SupabaseClient {
  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
  }
  if (!supabaseAnonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable');
  }

  if (!realtimeClient) {
    realtimeClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
        // Heartbeat configuration for better connection reliability
        heartbeatIntervalMs: 15000, // Send heartbeat every 15 seconds
        reconnectAfterMs: (tries: number) => {
          // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
          return Math.min(1000 * Math.pow(2, tries), 30000);
        },
      },
    });
  }

  return realtimeClient;
}

// Type exports for convenience
export type { SupabaseClient };
