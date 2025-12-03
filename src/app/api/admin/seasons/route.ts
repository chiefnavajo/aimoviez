// app/api/admin/seasons/route.ts
// Admin Seasons API - Create, list, and manage seasons
// Requires admin authentication

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GET /api/admin/seasons
 * List all seasons with stats
 */
export async function GET(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: seasons, error } = await supabase
      .from('seasons')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/admin/seasons] error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch seasons' },
        { status: 500 }
      );
    }

    // Fetch all slots for all seasons in ONE query (avoid N+1)
    const seasonIds = (seasons || []).map((s) => s.id);
    const { data: allSlots } = await supabase
      .from('story_slots')
      .select('season_id, status')
      .in('season_id', seasonIds);

    // Group slots by season_id
    const slotsBySeasonId = new Map<string, { locked: number; voting: number; upcoming: number }>();
    (allSlots || []).forEach((slot) => {
      if (!slotsBySeasonId.has(slot.season_id)) {
        slotsBySeasonId.set(slot.season_id, { locked: 0, voting: 0, upcoming: 0 });
      }
      const stats = slotsBySeasonId.get(slot.season_id)!;
      if (slot.status === 'locked') stats.locked++;
      else if (slot.status === 'voting') stats.voting++;
      else if (slot.status === 'upcoming') stats.upcoming++;
    });

    // Enrich seasons with stats (no additional queries)
    const enrichedSeasons = (seasons || []).map((season) => {
      const slotStats = slotsBySeasonId.get(season.id) || { locked: 0, voting: 0, upcoming: 0 };
      return {
        ...season,
        stats: {
          total_slots: season.total_slots || 75,
          locked_slots: slotStats.locked,
          voting_slots: slotStats.voting,
          upcoming_slots: slotStats.upcoming,
          completion_percent: Math.round((slotStats.locked / (season.total_slots || 75)) * 100),
        },
      };
    });

    return NextResponse.json({ seasons: enrichedSeasons }, { status: 200 });
  } catch (err: any) {
    console.error('[GET /api/admin/seasons] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/seasons
 * Create a new season with slots
 *
 * Body: {
 *   name: string,
 *   description?: string,
 *   total_slots?: number (default: 75),
 *   auto_activate?: boolean (default: false)
 * }
 */
export async function POST(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    const {
      name,
      description,
      total_slots = 75,
      auto_activate = false,
    } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Season name is required' },
        { status: 400 }
      );
    }

    // If auto_activate, deactivate all other seasons
    if (auto_activate) {
      await supabase
        .from('seasons')
        .update({ status: 'archived' })
        .eq('status', 'active');
    }

    // Create season
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .insert({
        name,
        description,
        total_slots,
        status: auto_activate ? 'active' : 'draft',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (seasonError || !season) {
      console.error('[POST /api/admin/seasons] seasonError:', seasonError);
      return NextResponse.json(
        { error: 'Failed to create season' },
        { status: 500 }
      );
    }

    // Create slots for this season
    const slots = Array.from({ length: total_slots }, (_, i) => ({
      season_id: season.id,
      slot_position: i + 1,
      status: 'upcoming' as const,
      created_at: new Date().toISOString(),
    }));

    const { error: slotsError } = await supabase
      .from('story_slots')
      .insert(slots);

    if (slotsError) {
      console.error('[POST /api/admin/seasons] slotsError:', slotsError);
      // Try to clean up the season if slots failed
      await supabase.from('seasons').delete().eq('id', season.id);
      return NextResponse.json(
        { error: 'Failed to create slots for season' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      season: {
        ...season,
        stats: {
          total_slots,
          locked_slots: 0,
          voting_slots: 0,
          upcoming_slots: total_slots,
          completion_percent: 0,
        },
      },
      message: `Season "${name}" created with ${total_slots} slots`,
    }, { status: 201 });
  } catch (err: any) {
    console.error('[POST /api/admin/seasons] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/seasons
 * Update a season's status or details
 *
 * Body: {
 *   season_id: string,
 *   status?: 'draft' | 'active' | 'archived',
 *   name?: string,
 *   description?: string
 * }
 */
export async function PATCH(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    const { season_id, status, name, description } = body;

    if (!season_id) {
      return NextResponse.json(
        { error: 'season_id is required' },
        { status: 400 }
      );
    }

    // Build update object
    const updates: any = {};
    if (status) {
      // If activating, deactivate all other seasons
      if (status === 'active') {
        await supabase
          .from('seasons')
          .update({ status: 'archived' })
          .eq('status', 'active')
          .neq('id', season_id);
      }
      updates.status = status;
    }
    if (name) updates.name = name;
    if (description !== undefined) updates.description = description;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No updates provided' },
        { status: 400 }
      );
    }

    const { data: season, error } = await supabase
      .from('seasons')
      .update(updates)
      .eq('id', season_id)
      .select()
      .single();

    if (error || !season) {
      console.error('[PATCH /api/admin/seasons] error:', error);
      return NextResponse.json(
        { error: 'Failed to update season' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      season,
      message: 'Season updated successfully',
    }, { status: 200 });
  } catch (err: any) {
    console.error('[PATCH /api/admin/seasons] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
