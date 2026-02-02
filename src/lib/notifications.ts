// lib/notifications.ts
// Notification helper functions (server-side only)

import { createClient } from '@supabase/supabase-js';
import { sanitizeUrl } from '@/lib/sanitize';

export type NotificationType =
  | 'clip_approved'
  | 'clip_rejected'
  | 'clip_locked_in'
  | 'slot_voting_started'
  | 'achievement_unlocked'
  | 'daily_goal_reached'
  | 'new_follower'
  | 'comment_received'
  | 'vote_received'
  | 'system_announcement';

/**
 * Helper function to create a notification (server-side only)
 * This function requires SUPABASE_SERVICE_ROLE_KEY and should only be called from API routes
 */
export async function createNotification(params: {
  user_key: string;
  type: NotificationType;
  title: string;
  message: string;
  action_url?: string;
  metadata?: Record<string, unknown>;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Guard against missing environment variables
  if (!supabaseUrl || !supabaseKey) {
    console.error('[createNotification] Missing Supabase environment variables');
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_key: params.user_key,
      type: params.type,
      title: params.title,
      message: params.message,
      action_url: params.action_url ? sanitizeUrl(params.action_url) : null,
      metadata: params.metadata || {},
      is_read: false,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('[createNotification] error:', error);
    return null;
  }

  return data;
}
