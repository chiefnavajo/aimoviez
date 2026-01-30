// app/api/admin/clips/[id]/route.ts
// ============================================================================
// ADMIN API - Update Clip Details
// Requires admin authentication
// ============================================================================

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

// GET - Fetch single clip
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit check
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const { id } = await params;
    const supabase = getSupabaseClient();

    const { data: clip, error } = await supabase
      .from('tournament_clips')
      .select('id, title, description, genre, status, video_url, thumbnail_url, username, avatar_url, vote_count, weighted_score, slot_position, created_at, updated_at')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch clip' },
        { status: 500 }
      );
    }

    if (!clip) {
      return NextResponse.json(
        { error: 'Clip not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      clip,
    });
  } catch (error) {
    console.error('GET /api/admin/clips/[id] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT - Update clip
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit check
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  // Get admin info for audit logging
  const adminAuth = await checkAdminAuth();

  try {
    const { id } = await params;
    const body = await request.json();
    const { title, description, genre, status } = body;

    // Validation
    if (!title || title.trim().length === 0) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }

    if (!genre || genre.trim().length === 0) {
      return NextResponse.json(
        { error: 'Genre is required' },
        { status: 400 }
      );
    }

    if (!status || !['pending', 'active', 'rejected'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Get current clip for audit log
    const { data: currentClip } = await supabase
      .from('tournament_clips')
      .select('title, genre, status, username, season_id')
      .eq('id', id)
      .single();

    // Build update object
    const updateData: {
      title: string;
      description: string;
      genre: string;
      status: string;
      updated_at: string;
      slot_position?: number;
    } = {
      title: title.trim(),
      description: description?.trim() || '',
      genre: genre.toLowerCase().trim(),
      status,
      updated_at: new Date().toISOString(),
    };

    // If changing status to 'active', also set slot_position to the current voting slot
    if (status === 'active' && currentClip?.status !== 'active' && currentClip?.season_id) {
      const { data: activeSlot } = await supabase
        .from('story_slots')
        .select('slot_position')
        .eq('season_id', currentClip.season_id)
        .eq('status', 'voting')
        .order('slot_position', { ascending: true })
        .limit(1)
        .maybeSingle();

      // Note: Use != null to handle slot_position=0 correctly (0 is falsy but valid)
      if (activeSlot?.slot_position != null) {
        updateData.slot_position = activeSlot.slot_position;
      }
    }

    // Update clip
    const { data, error } = await supabase
      .from('tournament_clips')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to update clip' },
        { status: 500 }
      );
    }

    // Audit log the action
    await logAdminAction(request, {
      action: 'edit_clip',
      resourceType: 'clip',
      resourceId: id,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        previousTitle: currentClip?.title,
        previousGenre: currentClip?.genre,
        previousStatus: currentClip?.status,
        newTitle: title.trim(),
        newGenre: genre.toLowerCase().trim(),
        newStatus: status,
        clipOwner: currentClip?.username,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Clip updated successfully',
      clip: data,
    });
  } catch (error) {
    console.error('PUT /api/admin/clips/[id] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Delete clip
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit check
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  // Get admin info for audit logging
  const adminAuth = await checkAdminAuth();

  try {
    const { id } = await params;
    const supabase = getSupabaseClient();

    // Get clip info before deletion for audit log and safety checks
    const { data: clipToDelete } = await supabase
      .from('tournament_clips')
      .select('id, title, username, genre, status, slot_position, season_id')
      .eq('id', id)
      .single();

    if (!clipToDelete) {
      return NextResponse.json(
        { error: 'Clip not found' },
        { status: 404 }
      );
    }

    // SAFETY CHECK 1: Prevent deleting a clip that is the winner of a locked slot
    const { data: winnerSlot } = await supabase
      .from('story_slots')
      .select('id, slot_position, status')
      .eq('winner_tournament_clip_id', id)
      .maybeSingle();

    if (winnerSlot) {
      return NextResponse.json(
        {
          error: `Cannot delete: this clip is the winner of Slot ${winnerSlot.slot_position}. Removing it would break the story board.`,
        },
        { status: 409 }
      );
    }

    // SAFETY CHECK 2: If last active clip in a voting slot, reset slot to waiting_for_clips
    if (clipToDelete.status === 'active' && clipToDelete.slot_position != null && clipToDelete.season_id) {
      const { count } = await supabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', clipToDelete.slot_position)
        .eq('season_id', clipToDelete.season_id)
        .eq('status', 'active')
        .neq('id', id);

      const { data: currentSlot } = await supabase
        .from('story_slots')
        .select('status')
        .eq('season_id', clipToDelete.season_id)
        .eq('slot_position', clipToDelete.slot_position)
        .maybeSingle();

      if (count === 0 && currentSlot?.status === 'voting') {
        await supabase
          .from('story_slots')
          .update({
            status: 'waiting_for_clips',
            voting_started_at: null,
            voting_ends_at: null,
          })
          .eq('season_id', clipToDelete.season_id)
          .eq('slot_position', clipToDelete.slot_position);

        console.log(`[admin/clips] Last active clip in voting Slot ${clipToDelete.slot_position} deleted — reset slot to waiting_for_clips`);
      }
    }

    const { error } = await supabase
      .from('tournament_clips')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to delete clip' },
        { status: 500 }
      );
    }

    // Audit log the action
    await logAdminAction(request, {
      action: 'delete_clip',
      resourceType: 'clip',
      resourceId: id,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        deletedTitle: clipToDelete?.title,
        deletedOwner: clipToDelete?.username,
        deletedGenre: clipToDelete?.genre,
        deletedStatus: clipToDelete?.status,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Clip deleted successfully',
    });
  } catch (error) {
    console.error('DELETE /api/admin/clips/[id] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
