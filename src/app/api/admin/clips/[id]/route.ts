// app/api/admin/clips/[id]/route.ts
// ============================================================================
// ADMIN API - Update Clip Details
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
  try {
    const { id } = await params;
    const supabase = getSupabaseClient();

    const { data: clip, error } = await supabase
      .from('tournament_clips')
      .select('*')
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
  try {
    const { id } = await params;
    const supabase = getSupabaseClient();

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
