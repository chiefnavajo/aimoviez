// app/api/cron/sync-leaderboards/route.ts
// ============================================================================
// LEADERBOARD SYNC CRON
// Keeps Redis Sorted Sets consistent with PostgreSQL.
// Runs every minute via Vercel Cron. Only active when redis_leaderboards enabled.
// Handles: active clip scores, all-time voter counts, daily voter counts, creator scores.
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  batchUpdateClipScores,
  batchUpdateVoterScores,
  batchUpdateCreatorScores,
} from '@/lib/leaderboard-redis';

// ============================================================================
// HELPERS
// ============================================================================

function createSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================================================
// ROUTE HANDLER
// ============================================================================

export async function GET(req: NextRequest) {
  // --- 1. CRON_SECRET validation ---
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      console.error('[sync-leaderboards] CRON_SECRET not set in production');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = createSupabaseClient();

  // --- 2. Feature flag check ---
  const { data: flag } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('key', 'redis_leaderboards')
    .maybeSingle();

  if (!flag?.enabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'redis_leaderboards disabled' });
  }

  // --- 3. Distributed lock ---
  const lockId = `slb_${Date.now()}`;
  const expiresAt = new Date(Date.now() + 60000).toISOString();

  // Atomic lock: delete expired, then insert (unique constraint prevents duplicates)
  const now = new Date().toISOString();
  await supabase
    .from('cron_locks')
    .delete()
    .eq('job_name', 'sync_leaderboards')
    .lt('expires_at', now);

  const { error: lockError } = await supabase
    .from('cron_locks')
    .insert({
      job_name: 'sync_leaderboards',
      lock_id: lockId,
      acquired_at: now,
      expires_at: expiresAt,
    });

  if (lockError) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Lock held by another instance' }, { status: 202 });
  }

  const stats = {
    clips: 0,
    votersAll: 0,
    votersDaily: 0,
    creators: 0,
  };

  try {
    // --- 4. Sync clip scores for active slot ---
    const { data: activeSlot } = await supabase
      .from('story_slots')
      .select('slot_position')
      .eq('status', 'voting')
      .maybeSingle();

    if (activeSlot) {
      const { data: activeClips } = await supabase
        .from('tournament_clips')
        .select('id, weighted_score')
        .eq('slot_position', activeSlot.slot_position)
        .eq('status', 'active');

      if (activeClips && activeClips.length > 0) {
        await batchUpdateClipScores(
          activeSlot.slot_position,
          activeClips.map(c => ({
            clipId: c.id,
            weightedScore: c.weighted_score || 0,
          }))
        );
        stats.clips = activeClips.length;
      }
    }

    // --- 5. Sync all-time voter scores ---
    // Use RPC if available, otherwise use materialized view
    const { data: voterRpcData, error: voterRpcError } = await supabase
      .rpc('get_top_voters', {
        p_limit: 1000,
        p_offset: 0,
        p_timeframe: 'all',
      });

    if (!voterRpcError && voterRpcData && voterRpcData.length > 0) {
      await batchUpdateVoterScores(
        voterRpcData.map((row: { voter_key: string; weighted_total?: number; total_votes?: number }) => ({
          voterKey: row.voter_key,
          totalVotes: Number(row.weighted_total) || Number(row.total_votes) || 0,
        })),
        'all'
      );
      stats.votersAll = voterRpcData.length;
    } else {
      // Fallback: use materialized view
      const { data: mvData } = await supabase
        .from('mv_user_vote_counts')
        .select('voter_key, vote_count')
        .order('vote_count', { ascending: false })
        .limit(1000);

      if (mvData && mvData.length > 0) {
        await batchUpdateVoterScores(
          mvData.map((row) => ({
            voterKey: row.voter_key,
            totalVotes: row.vote_count || 0,
          })),
          'all'
        );
        stats.votersAll = mvData.length;
      }
    }

    // --- 6. Sync today's voter scores ---
    const todayDate = new Date();
    todayDate.setUTCHours(0, 0, 0, 0);
    const todayStr = todayDate.toISOString();
    const todayKey = todayStr.split('T')[0];

    const { data: todayVoterRpc, error: todayVoterRpcError } = await supabase
      .rpc('get_top_voters', {
        p_limit: 500,
        p_offset: 0,
        p_timeframe: 'today',
      });

    if (!todayVoterRpcError && todayVoterRpc && todayVoterRpc.length > 0) {
      await batchUpdateVoterScores(
        todayVoterRpc.map((row: { voter_key: string; weighted_total?: number; total_votes?: number }) => ({
          voterKey: row.voter_key,
          totalVotes: Number(row.weighted_total) || Number(row.total_votes) || 0,
        })),
        'daily',
        todayKey
      );
      stats.votersDaily = todayVoterRpc.length;
    } else {
      // Fallback: count today's votes per voter_key
      const { data: todayVotes } = await supabase
        .from('votes')
        .select('voter_key, vote_weight')
        .gte('created_at', todayStr)
        .limit(10000);

      if (todayVotes && todayVotes.length > 0) {
        const voterMap = new Map<string, number>();
        todayVotes.forEach(v => {
          voterMap.set(v.voter_key, (voterMap.get(v.voter_key) || 0) + (v.vote_weight || 1));
        });

        await batchUpdateVoterScores(
          Array.from(voterMap.entries()).map(([voterKey, totalVotes]) => ({
            voterKey,
            totalVotes,
          })),
          'daily',
          todayKey
        );
        stats.votersDaily = voterMap.size;
      }
    }

    // --- 7. Sync creator scores ---
    const { data: creatorRpcData, error: creatorRpcError } = await supabase
      .rpc('get_top_creators', {
        p_limit: 500,
        p_offset: 0,
        p_timeframe: 'all',
      });

    if (!creatorRpcError && creatorRpcData && creatorRpcData.length > 0) {
      await batchUpdateCreatorScores(
        creatorRpcData.map((row: { username: string; total_votes?: number }) => ({
          username: row.username,
          totalVotes: Number(row.total_votes) || 0,
        }))
      );
      stats.creators = creatorRpcData.length;
    } else {
      // Fallback: aggregate from tournament_clips
      const { data: clips } = await supabase
        .from('tournament_clips')
        .select('username, vote_count')
        .limit(5000);

      if (clips && clips.length > 0) {
        const creatorMap = new Map<string, number>();
        clips.forEach(c => {
          const u = c.username || 'unknown';
          creatorMap.set(u, (creatorMap.get(u) || 0) + (c.vote_count || 0));
        });

        await batchUpdateCreatorScores(
          Array.from(creatorMap.entries()).map(([username, totalVotes]) => ({
            username,
            totalVotes,
          }))
        );
        stats.creators = creatorMap.size;
      }
    }

    return NextResponse.json({
      ok: true,
      stats,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[sync-leaderboards] Unexpected error:', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  } finally {
    // --- Release lock ---
    await supabase
      .from('cron_locks')
      .delete()
      .eq('job_name', 'sync_leaderboards')
      .eq('lock_id', lockId);
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
