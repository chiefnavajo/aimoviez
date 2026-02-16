// app/api/admin/slots/reorganize/route.ts
// Slot Reorganization API - Delete & Shift, Move, Swap slots
// Requires admin authentication

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface ReorganizeRequest {
  action: 'delete_and_shift' | 'swap_slots';
  season_id?: string;
  genre?: string;
  // For delete_and_shift
  slot_positions_to_delete?: number[];
  // For swap_slots
  slot_a_position?: number;
  slot_b_position?: number;
}

/**
 * POST /api/admin/slots/reorganize
 * Reorganize slots: delete & shift, or swap positions
 */
export async function POST(req: NextRequest) {
  // Rate limit check
  const rateLimitResponse = await rateLimit(req, 'admin_sensitive');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const adminAuth = await checkAdminAuth();

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body: ReorganizeRequest = await req.json();

    const { action, season_id } = body;

    if (!action) {
      return NextResponse.json(
        { error: 'action is required' },
        { status: 400 }
      );
    }

    // Get active season if not specified (genre-aware for multi-genre)
    const genreParam = body.genre?.toLowerCase();
    let targetSeasonId = season_id;
    if (!targetSeasonId) {
      let seasonQuery = supabase
        .from('seasons')
        .select('id')
        .eq('status', 'active');
      if (genreParam) {
        seasonQuery = seasonQuery.eq('genre', genreParam);
      }
      const { data: activeSeason } = await seasonQuery
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!activeSeason) {
        return NextResponse.json(
          { error: 'No active season found' },
          { status: 404 }
        );
      }
      targetSeasonId = activeSeason.id;
    }

    // ========================================================================
    // ACTION: DELETE AND SHIFT (Atomic via RPC)
    // ========================================================================
    if (action === 'delete_and_shift') {
      const { slot_positions_to_delete } = body;

      if (!slot_positions_to_delete || !Array.isArray(slot_positions_to_delete) || slot_positions_to_delete.length === 0) {
        return NextResponse.json(
          { error: 'slot_positions_to_delete is required and must be a non-empty array' },
          { status: 400 }
        );
      }

      // Validate all positions are positive integers
      if (!slot_positions_to_delete.every(p => Number.isInteger(p) && p > 0)) {
        return NextResponse.json(
          { error: 'All slot positions must be positive integers' },
          { status: 400 }
        );
      }

      // Limit array size to prevent DoS
      if (slot_positions_to_delete.length > 100) {
        return NextResponse.json(
          { error: 'Cannot delete more than 100 slots at once' },
          { status: 400 }
        );
      }

      const sortedPositions = [...slot_positions_to_delete].sort((a, b) => a - b);

      // Call atomic RPC function - all operations succeed or fail together
      const { data: rpcResult, error: rpcError } = await supabase.rpc('reorganize_slots_delete_and_shift', {
        p_season_id: targetSeasonId,
        p_positions_to_delete: sortedPositions,
      });

      if (rpcError) {
        console.error('[DELETE_AND_SHIFT] RPC error:', rpcError);
        // Handle specific error messages from the RPC function
        if (rpcError.message?.includes('voting status')) {
          return NextResponse.json(
            { error: 'Cannot delete slots in voting status. Change status first.', hint: 'Use the slot status change feature to set it to upcoming first.' },
            { status: 400 }
          );
        }
        return NextResponse.json(
          { error: 'Failed to reorganize slots' },
          { status: 500 }
        );
      }

      // Log audit action
      await logAdminAction(req, {
        action: 'slot_delete_and_shift',
        resourceType: 'slot',
        resourceId: targetSeasonId,
        adminEmail: adminAuth.email || 'unknown',
        adminId: adminAuth.userId || undefined,
        details: {
          deletedPositions: sortedPositions,
          deletedClipsCount: rpcResult?.deleted_clips || 0,
          deletedSlotsCount: rpcResult?.deleted_slots || 0,
          shiftAmount: sortedPositions.length,
        },
      });

      return NextResponse.json({
        success: true,
        action: 'delete_and_shift',
        deletedPositions: sortedPositions,
        deletedClipsCount: rpcResult?.deleted_clips || 0,
        deletedSlotsCount: rpcResult?.deleted_slots || 0,
        shiftAmount: sortedPositions.length,
        message: `Deleted ${sortedPositions.length} slot(s) and shifted remaining slots down`,
      });
    }

    // ========================================================================
    // ACTION: SWAP SLOTS (Atomic via RPC)
    // ========================================================================
    if (action === 'swap_slots') {
      const { slot_a_position, slot_b_position } = body;

      if (!slot_a_position || !slot_b_position) {
        return NextResponse.json(
          { error: 'slot_a_position and slot_b_position are required' },
          { status: 400 }
        );
      }

      if (slot_a_position === slot_b_position) {
        return NextResponse.json(
          { error: 'Cannot swap a slot with itself' },
          { status: 400 }
        );
      }

      // Validate positions are positive integers
      if (!Number.isInteger(slot_a_position) || !Number.isInteger(slot_b_position) || slot_a_position < 1 || slot_b_position < 1) {
        return NextResponse.json(
          { error: 'Slot positions must be positive integers' },
          { status: 400 }
        );
      }

      // Call atomic RPC function - all operations succeed or fail together
      const { data: rpcResult, error: rpcError } = await supabase.rpc('reorganize_slots_swap', {
        p_season_id: targetSeasonId,
        p_position_a: slot_a_position,
        p_position_b: slot_b_position,
      });

      if (rpcError) {
        console.error('[SWAP_SLOTS] RPC error:', rpcError);
        // Handle specific error messages from the RPC function
        if (rpcError.message?.includes('not found')) {
          return NextResponse.json(
            { error: 'One or both slots not found' },
            { status: 404 }
          );
        }
        if (rpcError.message?.includes('voting status')) {
          return NextResponse.json(
            { error: 'Cannot swap slots in voting status' },
            { status: 400 }
          );
        }
        return NextResponse.json(
          { error: 'Failed to swap slots' },
          { status: 500 }
        );
      }

      // Log audit action
      await logAdminAction(req, {
        action: 'slot_swap',
        resourceType: 'slot',
        resourceId: targetSeasonId,
        adminEmail: adminAuth.email || 'unknown',
        adminId: adminAuth.userId || undefined,
        details: {
          slot_a_position,
          slot_b_position,
          slot_a_status: rpcResult?.slot_a_status,
          slot_b_status: rpcResult?.slot_b_status,
        },
      });

      return NextResponse.json({
        success: true,
        action: 'swap_slots',
        swapped: [slot_a_position, slot_b_position],
        message: `Swapped slot ${slot_a_position} with slot ${slot_b_position}`,
      });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );

  } catch (err) {
    console.error('[POST /api/admin/slots/reorganize] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/slots/reorganize
 * Preview what would happen with a reorganization action (dry run)
 */
export async function GET(req: NextRequest) {
  // Rate limit check
  const rateLimitResponse = await rateLimit(req, 'admin_read');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(req.url);

    const action = searchParams.get('action');
    const positionsParam = searchParams.get('positions'); // comma-separated, e.g., "1,2"

    if (action === 'delete_and_shift' && positionsParam) {
      const positions = positionsParam.split(',').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p) && p > 0);

      if (positions.length === 0) {
        return NextResponse.json({ error: 'Invalid positions' }, { status: 400 });
      }

      // Get active season (genre-aware for multi-genre)
      const genrePreview = searchParams.get('genre')?.toLowerCase();
      let previewSeasonQuery = supabase
        .from('seasons')
        .select('id')
        .eq('status', 'active');
      if (genrePreview) {
        previewSeasonQuery = previewSeasonQuery.eq('genre', genrePreview);
      }
      const { data: activeSeason } = await previewSeasonQuery
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!activeSeason) {
        return NextResponse.json({ error: 'No active season' }, { status: 404 });
      }

      // Get slots that would be deleted
      const { data: slotsToDelete } = await supabase
        .from('story_slots')
        .select('slot_position, status, winner_tournament_clip_id')
        .eq('season_id', activeSeason.id)
        .in('slot_position', positions);

      // Get clips that would be deleted
      const { data: clipsToDelete } = await supabase
        .from('tournament_clips')
        .select('id, title, slot_position, status, username')
        .eq('season_id', activeSeason.id)
        .in('slot_position', positions);

      // Get clips that would be shifted
      const { data: clipsToShift } = await supabase
        .from('tournament_clips')
        .select('id, title, slot_position, status')
        .eq('season_id', activeSeason.id)
        .gt('slot_position', Math.min(...positions))
        .not('slot_position', 'in', `(${positions.join(',')})`);

      // Calculate new positions
      const sortedPositions = [...positions].sort((a, b) => a - b);
      const preview = clipsToShift?.map(clip => {
        const deletedBelow = sortedPositions.filter(p => p < clip.slot_position).length;
        return {
          ...clip,
          currentPosition: clip.slot_position,
          newPosition: clip.slot_position - deletedBelow,
        };
      }) || [];

      return NextResponse.json({
        action: 'delete_and_shift',
        preview: true,
        positionsToDelete: positions,
        slotsToDelete: slotsToDelete || [],
        clipsToDelete: clipsToDelete || [],
        clipsToShift: preview,
        shiftAmount: positions.length,
        warnings: slotsToDelete?.filter(s => s.status === 'voting').map(s =>
          `Slot ${s.slot_position} is currently voting`
        ) || [],
      });
    }

    return NextResponse.json({ error: 'Invalid action or missing parameters' }, { status: 400 });

  } catch (err) {
    console.error('[GET /api/admin/slots/reorganize] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
