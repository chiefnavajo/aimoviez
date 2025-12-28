// ============================================================================
// AUDIT LOGGING
// Tracks admin actions for security and compliance
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

// ============================================================================
// TYPES
// ============================================================================

export type AuditAction =
  | 'approve_clip'
  | 'reject_clip'
  | 'delete_clip'
  | 'edit_clip'
  | 'toggle_feature'
  | 'reset_season'
  | 'delete_season'
  | 'advance_slot'
  | 'assign_winner'
  | 'ban_user'
  | 'unban_user'
  | 'grant_admin'
  | 'revoke_admin'
  | 'update_username'
  | 'delete_comment'
  | 'bulk_action'
  | 'reset_user_votes';

export type ResourceType =
  | 'clip'
  | 'user'
  | 'season'
  | 'slot'
  | 'feature_flag'
  | 'comment'
  | 'vote';

export interface AuditLogEntry {
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string;
  details?: Record<string, unknown>;
  adminEmail: string;
  adminId?: string;
}

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

// ============================================================================
// AUDIT LOGGER
// ============================================================================

/**
 * Log an admin action for audit trail
 * Non-blocking - failures are logged but don't affect the main operation
 */
export async function logAdminAction(
  req: NextRequest,
  entry: AuditLogEntry
): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    // Extract request metadata
    const forwarded = req.headers.get('x-forwarded-for');
    const ipAddress = forwarded
      ? forwarded.split(',')[0].trim()
      : req.headers.get('x-real-ip') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // Insert audit log entry
    const { error } = await supabase.from('audit_logs').insert({
      admin_id: entry.adminId || null,
      admin_email: entry.adminEmail,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId || null,
      details: entry.details || {},
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    if (error) {
      console.error('[AUDIT] Failed to log admin action:', error);
    }
  } catch (err) {
    // Non-blocking - log error but don't throw
    console.error('[AUDIT] Error logging admin action:', err);
  }
}

/**
 * Get recent audit logs (for admin dashboard)
 */
export async function getAuditLogs(options?: {
  limit?: number;
  offset?: number;
  action?: AuditAction;
  resourceType?: ResourceType;
  adminEmail?: string;
  startDate?: Date;
  endDate?: Date;
}): Promise<{ logs: unknown[]; total: number }> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (options?.action) {
    query = query.eq('action', options.action);
  }
  if (options?.resourceType) {
    query = query.eq('resource_type', options.resourceType);
  }
  if (options?.adminEmail) {
    query = query.eq('admin_email', options.adminEmail);
  }
  if (options?.startDate) {
    query = query.gte('created_at', options.startDate.toISOString());
  }
  if (options?.endDate) {
    query = query.lte('created_at', options.endDate.toISOString());
  }

  const limit = options?.limit || 50;
  const offset = options?.offset || 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    console.error('[AUDIT] Failed to fetch audit logs:', error);
    return { logs: [], total: 0 };
  }

  return { logs: data || [], total: count || 0 };
}
