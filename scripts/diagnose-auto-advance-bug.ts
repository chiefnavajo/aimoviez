/**
 * Diagnostic Script: Auto-Advance Timer Bug
 *
 * Investigates why a slot has "voting" status with 0 clips and an active timer.
 *
 * Run with: npx ts-node scripts/diagnose-auto-advance-bug.ts
 * Or: npx tsx scripts/diagnose-auto-advance-bug.ts
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface DiagnosticResult {
  issue: string;
  details: Record<string, unknown>;
  possibleCause: string;
  suggestedFix: string;
}

async function diagnose() {
  console.log('🔍 Auto-Advance Timer Bug Diagnostic\n');
  console.log('='.repeat(60));

  const issues: DiagnosticResult[] = [];

  // =========================================================================
  // 1. Find all slots with voting status but 0 clips
  // =========================================================================
  console.log('\n📊 Step 1: Finding slots with voting status but 0 clips...\n');

  const { data: votingSlots, error: slotsError } = await supabase
    .from('story_slots')
    .select(`
      id,
      season_id,
      slot_position,
      status,
      voting_started_at,
      voting_ends_at,
      voting_duration_hours,
      winner_tournament_clip_id,
      seasons!inner(id, label, genre, status)
    `)
    .eq('status', 'voting');

  if (slotsError) {
    console.error('Error fetching slots:', slotsError.message);
    return;
  }

  for (const slot of votingSlots || []) {
    // Count active clips in this slot
    const { count: clipCount } = await supabase
      .from('tournament_clips')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', slot.season_id)
      .eq('slot_position', slot.slot_position)
      .eq('status', 'active');

    const season = slot.seasons as unknown as { label: string; genre: string; status: string };

    console.log(`Season: ${season.label} (${season.genre})`);
    console.log(`  Slot ${slot.slot_position}: status=${slot.status}, clips=${clipCount || 0}`);
    console.log(`  Timer: started=${slot.voting_started_at}, ends=${slot.voting_ends_at}`);

    if (slot.voting_ends_at) {
      const endsAt = new Date(slot.voting_ends_at);
      const now = new Date();
      const remainingMs = endsAt.getTime() - now.getTime();
      const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
      const remainingMins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
      console.log(`  Time remaining: ${remainingHours}h ${remainingMins}m`);
    }

    if ((clipCount || 0) === 0) {
      console.log(`  ⚠️  BUG DETECTED: Voting with 0 clips!\n`);

      issues.push({
        issue: `Slot ${slot.slot_position} in "${season.label}" has voting status but 0 clips`,
        details: {
          seasonId: slot.season_id,
          seasonLabel: season.label,
          slotPosition: slot.slot_position,
          votingStartedAt: slot.voting_started_at,
          votingEndsAt: slot.voting_ends_at,
          clipCount: 0,
        },
        possibleCause: 'See analysis below',
        suggestedFix: 'Set slot to waiting_for_clips and clear timer',
      });
    } else {
      console.log(`  ✅ OK: Has ${clipCount} clips\n`);
    }
  }

  if (issues.length === 0) {
    console.log('\n✅ No voting slots with 0 clips found.');
    return;
  }

  // =========================================================================
  // 2. For each buggy slot, investigate the cause
  // =========================================================================
  console.log('\n📊 Step 2: Investigating possible causes...\n');
  console.log('='.repeat(60));

  for (const issue of issues) {
    const { seasonId, slotPosition } = issue.details as { seasonId: string; slotPosition: number };

    console.log(`\n🔍 Investigating Season ${issue.details.seasonLabel}, Slot ${slotPosition}:`);

    // Check 1: Were there clips that got deleted/rejected?
    const { data: allClips } = await supabase
      .from('tournament_clips')
      .select('id, title, status, created_at, updated_at')
      .eq('season_id', seasonId)
      .eq('slot_position', slotPosition)
      .order('updated_at', { ascending: false });

    console.log(`\n  📁 All clips ever assigned to this slot: ${allClips?.length || 0}`);
    if (allClips && allClips.length > 0) {
      for (const clip of allClips.slice(0, 5)) {
        console.log(`    - ${clip.title} (status: ${clip.status}, updated: ${clip.updated_at})`);
      }
      if (allClips.length > 5) {
        console.log(`    ... and ${allClips.length - 5} more`);
      }

      issue.possibleCause = 'Clips were deleted or rejected after voting started';
    }

    // Check 2: Look at recent admin actions
    console.log(`\n  📋 Checking for recent clip status changes...`);

    const { data: recentChanges } = await supabase
      .from('tournament_clips')
      .select('id, title, status, updated_at')
      .eq('season_id', seasonId)
      .gte('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('updated_at', { ascending: false })
      .limit(10);

    if (recentChanges && recentChanges.length > 0) {
      console.log(`  Recent clip changes in this season (last 24h):`);
      for (const clip of recentChanges) {
        console.log(`    - ${clip.title}: status=${clip.status} at ${clip.updated_at}`);
      }
    } else {
      console.log(`  No recent clip changes found.`);
    }

    // Check 3: Look at cron lock status
    console.log(`\n  🔒 Checking cron lock status...`);

    const { data: cronLocks } = await supabase
      .from('cron_locks')
      .select('*')
      .eq('job_name', 'auto-advance');

    if (cronLocks && cronLocks.length > 0) {
      for (const lock of cronLocks) {
        const expiresAt = new Date(lock.expires_at);
        const isExpired = expiresAt < new Date();
        console.log(`    Lock ID: ${lock.lock_id}`);
        console.log(`    Expires: ${lock.expires_at} (${isExpired ? 'EXPIRED' : 'ACTIVE'})`);

        if (!isExpired) {
          issue.possibleCause = 'Cron job lock is held - auto-advance may be stuck';
        }
      }
    } else {
      console.log(`    No active cron locks found.`);
    }

    // Check 4: Is the timer expired but not processed?
    if (issue.details.votingEndsAt) {
      const endsAt = new Date(issue.details.votingEndsAt as string);
      if (endsAt < new Date()) {
        console.log(`\n  ⏰ Timer EXPIRED but slot not advanced!`);
        issue.possibleCause = 'Timer expired but cron job did not run or failed';
      }
    }

    // Check 5: Was the slot manually set to voting without clips?
    console.log(`\n  🔧 Possible root causes:`);
    console.log(`    1. Admin manually set slot to 'voting' before approving clips`);
    console.log(`    2. All clips were deleted/rejected after voting started`);
    console.log(`    3. Auto-advance cron failed or is not running`);
    console.log(`    4. Race condition during clip deletion`);
  }

  // =========================================================================
  // 3. Generate fix commands
  // =========================================================================
  console.log('\n\n📊 Step 3: Suggested Fixes\n');
  console.log('='.repeat(60));

  for (const issue of issues) {
    const { seasonId, slotPosition } = issue.details as { seasonId: string; slotPosition: number };

    console.log(`\n🔧 Fix for Season "${issue.details.seasonLabel}", Slot ${slotPosition}:`);
    console.log(`\n   Option A: Set to waiting_for_clips (wait for new clips):`);
    console.log(`   ---------------------------------------------------------`);
    console.log(`   UPDATE story_slots`);
    console.log(`   SET status = 'waiting_for_clips',`);
    console.log(`       voting_started_at = NULL,`);
    console.log(`       voting_ends_at = NULL`);
    console.log(`   WHERE season_id = '${seasonId}'`);
    console.log(`     AND slot_position = ${slotPosition};`);

    console.log(`\n   Option B: Skip this slot (advance to next):`);
    console.log(`   ---------------------------------------------------------`);
    console.log(`   -- First lock this slot without a winner`);
    console.log(`   UPDATE story_slots`);
    console.log(`   SET status = 'locked',`);
    console.log(`       voting_started_at = NULL,`);
    console.log(`       voting_ends_at = NULL`);
    console.log(`   WHERE season_id = '${seasonId}'`);
    console.log(`     AND slot_position = ${slotPosition};`);
    console.log(`   `);
    console.log(`   -- Then set next slot to waiting_for_clips`);
    console.log(`   UPDATE story_slots`);
    console.log(`   SET status = 'waiting_for_clips'`);
    console.log(`   WHERE season_id = '${seasonId}'`);
    console.log(`     AND slot_position = ${slotPosition + 1};`);
  }

  // =========================================================================
  // 4. Check cron job health
  // =========================================================================
  console.log('\n\n📊 Step 4: Cron Job Health Check\n');
  console.log('='.repeat(60));

  // Check if there are any stale locks
  const { data: staleLocks } = await supabase
    .from('cron_locks')
    .select('*')
    .lt('expires_at', new Date().toISOString());

  if (staleLocks && staleLocks.length > 0) {
    console.log(`\n⚠️  Found ${staleLocks.length} expired cron locks:`);
    for (const lock of staleLocks) {
      console.log(`   - ${lock.job_name}: expired at ${lock.expires_at}`);
    }
    console.log(`\n   These should be cleaned up. Run:`);
    console.log(`   DELETE FROM cron_locks WHERE expires_at < NOW();`);
  } else {
    console.log(`\n✅ No stale cron locks found.`);
  }

  // Check Vercel cron configuration
  console.log(`\n📋 Verify Vercel Cron is configured:`);
  console.log(`   - Check vercel.json for cron configuration`);
  console.log(`   - Verify /api/cron/auto-advance endpoint is accessible`);
  console.log(`   - Check Vercel dashboard for cron job logs`);

  // =========================================================================
  // 5. Summary
  // =========================================================================
  console.log('\n\n📊 Summary\n');
  console.log('='.repeat(60));
  console.log(`\nFound ${issues.length} slot(s) with voting status but 0 clips.`);
  console.log(`\nMost likely causes:`);
  console.log(`  1. Clips were deleted after voting timer started`);
  console.log(`  2. Auto-advance cron job is not running or failing`);
  console.log(`  3. Admin manually changed slot status without checking clips`);
  console.log(`\nTo prevent this in the future:`);
  console.log(`  - Add a database trigger to clear timer when last clip is deleted`);
  console.log(`  - Add a check in the admin UI before setting slot to 'voting'`);
  console.log(`  - Ensure auto-advance cron runs every minute`);
}

// Run diagnostic
diagnose().catch(console.error);
