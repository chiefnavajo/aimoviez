// ============================================================================
// AUDIT LOGGING
// Tracks admin actions for security and compliance
// SECURITY: Sensitive fields are redacted before storage
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

export type AuditAction =
  | 'approve_clip'
  | 'reject_clip'
  | 'delete_clip'
  | 'edit_clip'
  | 'toggle_feature'
  | 'create_season'
  | 'update_season'
  | 'reset_season'
  | 'delete_season'
  | 'advance_slot'
  | 'assign_winner'
  | 'ban_user'
  | 'unban_user'
  | 'grant_admin'
  | 'revoke_admin'
  | 'update_username'
  | 'set_ai_limit'
  | 'delete_comment'
  | 'bulk_action'
  | 'reset_user_votes'
  | 'free_assign_clip'
  | 'god_mode_status_change'
  | 'god_mode_slot_status_change'
  | 'slot_delete_and_shift'
  | 'slot_swap'
  | 'ai_generate'
  | 'ai_complete'
  | 'ai_register'
  // AI Co-Director actions
  | 'analyze_story'
  | 'generate_directions'
  | 'open_direction_vote'
  | 'close_direction_vote'
  | 'generate_brief'
  | 'publish_brief'
  | 'unpublish_brief'
  | 'update_brief'
  | 'score_submission'
  // AI Movie Generation actions
  | 'movie_access_grant'
  | 'movie_access_revoke'
  // Character reference suggestion actions
  | 'approve_reference_suggestion'
  | 'reject_reference_suggestion';

export type ResourceType =
  | 'clip'
  | 'user'
  | 'season'
  | 'slot'
  | 'feature_flag'
  | 'comment'
  | 'vote'
  | 'ai_generation'
  // AI Co-Director resources
  | 'story_analysis'
  | 'direction_option'
  | 'direction_vote'
  | 'slot_brief'
  | 'submission_score'
  // AI Movie Generation resources
  | 'movie_access'
  | 'movie_project'
  // Character reference suggestions
  | 'character_reference_suggestion';

export interface AuditLogEntry {
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string;
  details?: Record<string, unknown>;
  adminEmail?: string;  // SECURITY: Only used for lookup, not stored directly
  adminId?: string;     // Preferred: store ID instead of email
}

// ============================================================================
// SECURITY HELPERS
// ============================================================================

/**
 * Hash sensitive text for audit logs (one-way, for integrity verification)
 */
function hashSensitiveText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);
}

/**
 * Redact sensitive fields from audit log details
 * SECURITY: Removes PII and sensitive data before storage
 */
function redactSensitiveDetails(details: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...details };

  // Hash admin notes (free text could contain PII)
  if (typeof redacted.adminNotes === 'string' && redacted.adminNotes) {
    redacted.adminNotes_hash = hashSensitiveText(redacted.adminNotes);
    redacted.adminNotes_length = redacted.adminNotes.length;
    delete redacted.adminNotes;
  }

  // Hash admin_notes variant
  if (typeof redacted.admin_notes === 'string' && redacted.admin_notes) {
    redacted.admin_notes_hash = hashSensitiveText(redacted.admin_notes);
    redacted.admin_notes_length = (redacted.admin_notes as string).length;
    delete redacted.admin_notes;
  }

  // Hash reason field (could contain sensitive info)
  if (typeof redacted.reason === 'string' && redacted.reason) {
    redacted.reason_hash = hashSensitiveText(redacted.reason);
    redacted.reason_length = redacted.reason.length;
    delete redacted.reason;
  }

  // Remove email addresses from details
  if (typeof redacted.email === 'string') {
    delete redacted.email;
  }

  return redacted;
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
 * SECURITY: Sensitive fields are redacted before storage
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

    // SECURITY: Redact sensitive details before storage
    const redactedDetails = entry.details
      ? redactSensitiveDetails(entry.details)
      : {};

    // SECURITY: Hash IP address for privacy (still allows pattern matching)
    const ipHash = crypto.createHash('sha256').update(ipAddress).digest('hex').substring(0, 16);

    // Insert audit log entry
    // SECURITY: Store admin_id instead of admin_email when possible
    const { error } = await supabase.from('audit_logs').insert({
      admin_id: entry.adminId || null,
      admin_email: entry.adminId ? null : entry.adminEmail, // Only store email if no ID available
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId || null,
      details: redactedDetails,
      ip_address: ipHash, // Store hash instead of raw IP
      user_agent: userAgent?.substring(0, 200) || 'unknown', // Truncate long UA strings
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

  const limit = Math.min(options?.limit || 50, 100); // FIX: Cap limit at 100
  const offset = Math.min(options?.offset || 0, 10000); // FIX: Cap offset to prevent abuse
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    console.error('[AUDIT] Failed to fetch audit logs:', error);
    return { logs: [], total: 0 };
  }

  return { logs: data || [], total: count || 0 };
}
