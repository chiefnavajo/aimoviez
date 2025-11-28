// app/api/admin/approve/route.ts
// ============================================================================
// ADMIN API - Approve Clip
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clipId } = body;

    if (!clipId) {
      return NextResponse.json(
        { error: 'Clip ID is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Update clip status to 'active'
    const { data, error } = await supabase
      .from('tournament_clips')
      .update({ 
        status: 'active',
        updated_at: new Date().toISOString()
      })
      .eq('id', clipId)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to approve clip' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Clip approved successfully',
      clip: data,
    });
  } catch (error) {
    console.error('POST /api/admin/approve error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
