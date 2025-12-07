// app/api/admin/clips/[id]/route.ts
// ============================================================================
// ADMIN API - Update Clip Details
// Requires admin authentication
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';

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
      .select('title, genre, status, username')
      .eq('id', id)
      .single();

    // Update clip
    const { data, error } = await supabase
      .from('tournament_clips')
      .update({
        title: title.trim(),
        description: description?.trim() || '',
        genre: genre.toLowerCase().trim(),
        status,
        updated_at: new Date().toISOString(),
      })
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
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  // Get admin info for audit logging
  const adminAuth = await checkAdminAuth();

  try {
    const { id } = await params;
    const supabase = getSupabaseClient();

    // Get clip info before deletion for audit log
    const { data: clipToDelete } = await supabase
      .from('tournament_clips')
      .select('title, username, genre, status')
      .eq('id', id)
      .single();

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
