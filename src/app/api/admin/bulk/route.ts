// app/api/admin/bulk/route.ts
// Bulk operations for admin (approve/reject multiple clips)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

/**
 * POST /api/admin/bulk
 * Perform bulk operations on clips
 *
 * Body: {
 *   action: 'approve' | 'reject' | 'delete',
 *   clipIds: string[]
 * }
 */
export async function POST(request: NextRequest) {
  // Rate limit bulk operations: 50 per minute (prevent accidental mass operations)
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const adminAuth = await checkAdminAuth();

  try {
    const body = await request.json();
    const { action, clipIds } = body;

    if (!action || !['approve', 'reject', 'delete', 'reset_to_pending'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be: approve, reject, delete, or reset_to_pending' },
        { status: 400 }
      );
    }

    if (!clipIds || !Array.isArray(clipIds) || clipIds.length === 0) {
      return NextResponse.json(
        { error: 'clipIds must be a non-empty array' },
        { status: 400 }
      );
    }

    if (clipIds.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 clips per bulk operation' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    let updatedCount = 0;
    let hasErrors = false;

    if (action === 'approve') {
      // H8: Look up the current active slot so we can assign slot_position
      // First get any clip to determine its season_id
      const { data: sampleClip } = await supabase
        .from('tournament_clips')
        .select('season_id')
        .in('id', clipIds)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();

      let slotPosition: number | undefined;
      if (sampleClip?.season_id) {
        const { data: activeSlot } = await supabase
          .from('story_slots')
          .select('slot_position')
          .eq('season_id', sampleClip.season_id)
          .in('status', ['voting', 'waiting_for_clips'])
          .order('slot_position', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (activeSlot?.slot_position != null) {
          slotPosition = activeSlot.slot_position;
        }
      }

      const updateData: Record<string, unknown> = {
        status: 'active',
        updated_at: new Date().toISOString(),
      };
      if (slotPosition != null) {
        updateData.slot_position = slotPosition;
      }

      const { data, error } = await supabase
        .from('tournament_clips')
        .update(updateData)
        .in('id', clipIds)
        .eq('status', 'pending')
        .select('id');

      if (error) {
        console.error('[BULK] Approve error:', error);
        hasErrors = true;
      } else {
        updatedCount = data?.length || 0;
      }
    } else if (action === 'reject') {
      const { data, error } = await supabase
        .from('tournament_clips')
        .update({ status: 'rejected' })
        .in('id', clipIds)
        .eq('status', 'pending')
        .select('id');

      if (error) {
        console.error('[BULK] Reject error:', error);
        hasErrors = true;
      } else {
        updatedCount = data?.length || 0;
      }
    } else if (action === 'reset_to_pending') {
      // M1: Before resetting, get affected clips' slot info for cleanup
      const { data: affectedClips } = await supabase
        .from('tournament_clips')
        .select('id, slot_position, season_id')
        .in('id', clipIds)
        .eq('status', 'active');

      // Reset active clips to pending status
      const { data, error } = await supabase
        .from('tournament_clips')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .in('id', clipIds)
        .eq('status', 'active')
        .select('id');

      if (error) {
        console.error('[BULK] Reset to pending error:', error);
        hasErrors = true;
      } else {
        updatedCount = data?.length || 0;
      }

      // M1: Check if any voting slots now have zero active clips
      if (affectedClips && affectedClips.length > 0) {
        const slotsToCheck = new Map<string, { slotPosition: number; seasonId: string }>();
        for (const clip of affectedClips) {
          if (clip.slot_position != null && clip.season_id) {
            const key = `${clip.season_id}_${clip.slot_position}`;
            slotsToCheck.set(key, { slotPosition: clip.slot_position, seasonId: clip.season_id });
          }
        }

        for (const { slotPosition, seasonId } of slotsToCheck.values()) {
          const { count } = await supabase
            .from('tournament_clips')
            .select('id', { count: 'exact', head: true })
            .eq('slot_position', slotPosition)
            .eq('season_id', seasonId)
            .eq('status', 'active');

          if (count === 0) {
            await supabase
              .from('story_slots')
              .update({
                status: 'waiting_for_clips',
                voting_started_at: null,
                voting_ends_at: null,
              })
              .eq('season_id', seasonId)
              .eq('slot_position', slotPosition)
              .eq('status', 'voting');

            console.log(`[BULK] Reset all active clips in Slot ${slotPosition} — reset slot to waiting_for_clips`);
          }
        }
      }
    } else if (action === 'delete') {
      // H9: Check for winner clips that cannot be deleted
      const { data: winnerSlots } = await supabase
        .from('story_slots')
        .select('slot_position, winner_tournament_clip_id')
        .in('winner_tournament_clip_id', clipIds);

      const winnerClipIds = new Set(winnerSlots?.map(s => s.winner_tournament_clip_id).filter(Boolean) || []);
      const deletableIds = clipIds.filter((id: string) => !winnerClipIds.has(id));

      if (winnerClipIds.size > 0 && deletableIds.length === 0) {
        return NextResponse.json({
          success: false,
          error: `Cannot delete: ${winnerClipIds.size} clip(s) are winners of locked slots. Remove them as winners first.`,
          winnerClipIds: Array.from(winnerClipIds),
        }, { status: 409 });
      }

      if (deletableIds.length > 0) {
        // H9: Check for last-active-clip-in-slot before deleting
        const { data: activeClipsToDelete } = await supabase
          .from('tournament_clips')
          .select('id, slot_position, season_id')
          .in('id', deletableIds)
          .eq('status', 'active');

        // Delete the clips
        const { data, error } = await supabase
          .from('tournament_clips')
          .delete()
          .in('id', deletableIds)
          .select('id');

        if (error) {
          console.error('[BULK] Delete error:', error);
          hasErrors = true;
        } else {
          updatedCount = data?.length || 0;
        }

        // Check if any voting slots now have zero active clips
        if (activeClipsToDelete && activeClipsToDelete.length > 0) {
          const slotsToCheck = new Map<string, { slotPosition: number; seasonId: string }>();
          for (const clip of activeClipsToDelete) {
            if (clip.slot_position != null && clip.season_id) {
              const key = `${clip.season_id}_${clip.slot_position}`;
              slotsToCheck.set(key, { slotPosition: clip.slot_position, seasonId: clip.season_id });
            }
          }

          for (const { slotPosition, seasonId } of slotsToCheck.values()) {
            const { count } = await supabase
              .from('tournament_clips')
              .select('id', { count: 'exact', head: true })
              .eq('slot_position', slotPosition)
              .eq('season_id', seasonId)
              .eq('status', 'active');

            if (count === 0) {
              await supabase
                .from('story_slots')
                .update({
                  status: 'waiting_for_clips',
                  voting_started_at: null,
                  voting_ends_at: null,
                })
                .eq('season_id', seasonId)
                .eq('slot_position', slotPosition)
                .eq('status', 'voting');

              console.log(`[BULK] Deleted all active clips in Slot ${slotPosition} — reset slot to waiting_for_clips`);
            }
          }
        }
      } else {
        updatedCount = 0;
      }

      if (winnerClipIds.size > 0) {
        hasErrors = true; // Partial failure — some clips couldn't be deleted
      }
    }

    // Log the bulk action
    await logAdminAction(request, {
      action: 'bulk_action',
      resourceType: 'clip',
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        bulkAction: action,
        clipIds,
        updatedCount,
        hasErrors,
      },
    });

    return NextResponse.json({
      success: !hasErrors,
      action,
      requested: clipIds.length,
      updated: updatedCount,
      // Don't expose internal error details - just indicate if there were errors
      message: hasErrors ? 'Some operations failed' : undefined,
    });
  } catch (error) {
    console.error('Bulk operation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
