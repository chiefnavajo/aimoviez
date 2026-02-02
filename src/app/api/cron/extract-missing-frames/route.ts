// app/api/cron/extract-missing-frames/route.ts
// ============================================================================
// BACKFILL CRON — Extract last frames for winning clips that are missing them.
// Handles edge cases where the fire-and-forget call from winner paths failed.
// Runs hourly, processes up to 5 clips per run.
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // 5 sequential extraction calls at ~55s each

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

const BATCH_SIZE = 5;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
  } else if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  try {
    // Find locked clips missing last_frame_url
    const { data: clips, error } = await supabase
      .from('tournament_clips')
      .select('id')
      .eq('status', 'locked')
      .is('last_frame_url', null)
      .not('video_url', 'is', null)
      .limit(BATCH_SIZE);

    if (error) {
      console.error('[extract-missing-frames] Query error:', error);
      return NextResponse.json({ error: 'Query failed' }, { status: 500 });
    }

    if (!clips || clips.length === 0) {
      return NextResponse.json({ ok: true, message: 'No missing frames', processed: 0 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    let processed = 0;
    let errors = 0;

    for (const clip of clips) {
      try {
        const res = await fetch(`${baseUrl}/api/internal/extract-frame`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cronSecret}`,
          },
          body: JSON.stringify({ clipId: clip.id }),
          signal: AbortSignal.timeout(55_000),
        });

        if (res.ok) {
          processed++;
        } else {
          const body = await res.json().catch(() => ({}));
          console.warn(`[extract-missing-frames] Failed for clip ${clip.id}:`, body);
          errors++;
        }
      } catch (err) {
        console.error(`[extract-missing-frames] Error for clip ${clip.id}:`, err);
        errors++;
      }
    }

    console.log(`[extract-missing-frames] Processed ${processed}, errors ${errors}`);
    return NextResponse.json({ ok: true, processed, errors, total: clips.length });
  } catch (err) {
    console.error('[extract-missing-frames] Unexpected error:', err);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
