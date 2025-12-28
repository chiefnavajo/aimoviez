// app/api/admin/seasons/route.ts
// Admin Seasons API - Create, list, manage, and delete seasons
// Requires admin authentication

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GET /api/admin/seasons
 * List all seasons with stats
 */
export async function GET(req: NextRequest) {
  // Rate limit check
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: seasons, error } = await supabase
      .from('seasons')
      .select('id, label, status, total_slots, created_at')
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

    // Skip the slots query if there are no seasons (empty .in() can fail)
    const allSlots = seasonIds.length > 0
      ? (await supabase
          .from('story_slots')
          .select('season_id, status')
          .in('season_id', seasonIds)).data
      : [];

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
  } catch (err) {
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
 *   label: string,
 *   total_slots?: number (default: 75),
 *   auto_activate?: boolean (default: false)
 * }
 */
export async function POST(req: NextRequest) {
  // Rate limit check
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    const {
      label,
      total_slots = 75,
      auto_activate = false,
    } = body;

    if (!label) {
      return NextResponse.json(
        { error: 'Season label is required' },
        { status: 400 }
      );
    }

    // If auto_activate, finish all other active seasons
    if (auto_activate) {
      await supabase
        .from('seasons')
        .update({ status: 'finished' })
        .eq('status', 'active');
    }

    // Create season
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .insert({
        label,
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
    // If auto_activate, set first slot to 'voting' (timer starts when first clip is uploaded)
    const slots = Array.from({ length: total_slots }, (_, i) => ({
      season_id: season.id,
      slot_position: i + 1,
      status: (auto_activate && i === 0) ? 'voting' : 'upcoming',
      voting_started_at: null, // Timer starts when first clip is uploaded
      voting_ends_at: null,
      voting_duration_hours: 24,
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
      message: `Season "${label}" created with ${total_slots} slots`,
    }, { status: 201 });
  } catch (err) {
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
 *   label?: string
 * }
 */
export async function PATCH(req: NextRequest) {
  // Rate limit check
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    const { season_id, status, label } = body;

    if (!season_id) {
      return NextResponse.json(
        { error: 'season_id is required' },
        { status: 400 }
      );
    }

    // Build update object
    const updates: Record<string, string> = {};
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
    if (label) updates.label = label;

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
  } catch (err) {
    console.error('[PATCH /api/admin/seasons] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/seasons
 * Permanently delete a season and all its data (slots, clips, votes)
 *
 * Body: {
 *   season_id: string,
 *   confirm: boolean (must be true to proceed)
 * }
 *
 * WARNING: This is a destructive operation that cannot be undone.
 * All slots, clips, and votes associated with the season will be deleted.
 */
export async function DELETE(req: NextRequest) {
  // Rate limit check
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  // Get admin info for audit logging
  const adminAuth = await checkAdminAuth();

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    const { season_id, confirm } = body;

    if (!season_id) {
      return NextResponse.json(
        { error: 'season_id is required' },
        { status: 400 }
      );
    }

    if (confirm !== true) {
      return NextResponse.json(
        { error: 'Must set confirm: true to delete a season. This action cannot be undone.' },
        { status: 400 }
      );
    }

    // Get season details for validation and audit log
    const { data: season, error: fetchError } = await supabase
      .from('seasons')
      .select('id, label, status, total_slots')
      .eq('id', season_id)
      .single();

    if (fetchError || !season) {
      return NextResponse.json(
        { error: 'Season not found' },
        { status: 404 }
      );
    }

    // Prevent deleting active season
    if (season.status === 'active') {
      return NextResponse.json(
        { error: 'Cannot delete an active season. Archive or finish it first.' },
        { status: 400 }
      );
    }

    // Get counts for audit log before deletion
    const { count: clipCount } = await supabase
      .from('tournament_clips')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', season_id);

    const { count: slotCount } = await supabase
      .from('story_slots')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', season_id);

    // Delete story_slots first (no cascade from seasons)
    const { error: slotsDeleteError } = await supabase
      .from('story_slots')
      .delete()
      .eq('season_id', season_id);

    if (slotsDeleteError) {
      console.error('[DELETE /api/admin/seasons] Failed to delete slots:', slotsDeleteError);
      return NextResponse.json(
        { error: 'Failed to delete season slots' },
        { status: 500 }
      );
    }

    // Delete tournament_clips (votes will cascade due to FK)
    const { error: clipsDeleteError } = await supabase
      .from('tournament_clips')
      .delete()
      .eq('season_id', season_id);

    if (clipsDeleteError) {
      console.error('[DELETE /api/admin/seasons] Failed to delete clips:', clipsDeleteError);
      return NextResponse.json(
        { error: 'Failed to delete season clips' },
        { status: 500 }
      );
    }

    // Delete the season itself
    const { error: seasonDeleteError } = await supabase
      .from('seasons')
      .delete()
      .eq('id', season_id);

    if (seasonDeleteError) {
      console.error('[DELETE /api/admin/seasons] Failed to delete season:', seasonDeleteError);
      return NextResponse.json(
        { error: 'Failed to delete season' },
        { status: 500 }
      );
    }

    // Audit log the deletion
    await logAdminAction(req, {
      action: 'delete_season',
      resourceType: 'season',
      resourceId: season_id,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        seasonLabel: season.label,
        seasonStatus: season.status,
        slotsDeleted: slotCount || 0,
        clipsDeleted: clipCount || 0,
      },
    });

    console.log(`[DELETE /api/admin/seasons] Deleted season "${season.label}" with ${slotCount} slots and ${clipCount} clips`);

    return NextResponse.json({
      success: true,
      message: `Season "${season.label}" permanently deleted`,
      deleted: {
        season_id: season_id,
        season_label: season.label,
        slots_deleted: slotCount || 0,
        clips_deleted: clipCount || 0,
      },
    }, { status: 200 });
  } catch (err) {
    console.error('[DELETE /api/admin/seasons] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
