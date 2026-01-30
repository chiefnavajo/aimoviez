// app/api/referral/route.ts
// ============================================================================
// REFERRAL API - Get user's referral info, generate codes, track referrals
// Requires authentication
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

// ============================================================================
// CHECK IF FEATURE IS ENABLED
// ============================================================================

async function isFeatureEnabled(key: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('key', key)
    .single();
  return data?.enabled ?? false;
}

// ============================================================================
// REFERRAL TIERS
// ============================================================================

const REFERRAL_TIERS = [
  { count: 1, title: 'Connector', reward: 50, badge: null },
  { count: 5, title: 'Networker', reward: 100, badge: 'networker' },
  { count: 10, title: 'Influencer', reward: 200, badge: 'influencer' },
  { count: 25, title: 'Ambassador', reward: 500, badge: 'ambassador' },
  { count: 100, title: 'Legend', reward: 1000, badge: 'legend' },
];

function getCurrentTier(referralCount: number) {
  let currentTier = null;
  for (const tier of REFERRAL_TIERS) {
    if (referralCount >= tier.count) {
      currentTier = tier;
    }
  }
  return currentTier;
}

function getNextTier(referralCount: number) {
  for (const tier of REFERRAL_TIERS) {
    if (referralCount < tier.count) {
      return tier;
    }
  }
  return null;
}

// ============================================================================
// GET - Get user's referral info
// ============================================================================

export async function GET() {
  try {
    // Check if feature is enabled
    if (!(await isFeatureEnabled('referral_system'))) {
      return NextResponse.json({
        enabled: false,
        message: 'Referral system is not enabled',
      });
    }

    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseClient();

    // Get user profile
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, referral_code, referral_count, referred_by')
      .eq('email', session.user.email)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Generate referral code if not exists
    let referralCode = user.referral_code;
    if (!referralCode) {
      referralCode = generateReferralCode(user.id);
      await supabase
        .from('users')
        .update({ referral_code: referralCode })
        .eq('id', user.id);
    }

    // Get referral history
    const { data: referrals } = await supabase
      .from('referrals')
      .select('id, status, reward_amount, created_at, completed_at')
      .eq('referrer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    const completedReferrals = (referrals || []).filter(r => r.status === 'completed' || r.status === 'rewarded');
    const pendingReferrals = (referrals || []).filter(r => r.status === 'pending');
    const totalRewards = (referrals || []).reduce((sum, r) => sum + (r.reward_amount || 0), 0);

    // Get current and next tier
    const currentTier = getCurrentTier(user.referral_count || 0);
    const nextTier = getNextTier(user.referral_count || 0);

    // Build referral link
    const baseUrl = process.env.NEXTAUTH_URL || 'https://www.aimoviez.app';
    const referralLink = `${baseUrl}/join/${referralCode}`;

    return NextResponse.json({
      enabled: true,
      referral_code: referralCode,
      referral_link: referralLink,
      referral_count: user.referral_count || 0,
      completed_referrals: completedReferrals.length,
      pending_referrals: pendingReferrals.length,
      total_rewards: totalRewards,
      current_tier: currentTier,
      next_tier: nextTier,
      progress_to_next: nextTier
        ? Math.round(((user.referral_count || 0) / nextTier.count) * 100)
        : 100,
      referrals: referrals || [],
      tiers: REFERRAL_TIERS,
    });

  } catch (error) {
    console.error('[REFERRAL] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// POST - Track a referral (called during signup)
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Check if feature is enabled
    if (!(await isFeatureEnabled('referral_system'))) {
      return NextResponse.json({
        success: false,
        message: 'Referral system is not enabled',
      });
    }

    const body = await request.json();
    const { referral_code, new_user_id } = body;

    if (!referral_code) {
      return NextResponse.json({ error: 'Referral code is required' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // Find referrer by code
    const { data: referrer, error: referrerError } = await supabase
      .from('users')
      .select('id, referral_count')
      .eq('referral_code', referral_code.toUpperCase())
      .single();

    // SECURITY: Don't reveal whether code exists or not (prevents enumeration)
    // Return success-like response for invalid codes, but don't create referral
    if (referrerError || !referrer) {
      console.warn('[REFERRAL] Invalid code attempt:', referral_code.slice(0, 4) + '***');
      return NextResponse.json({
        success: true,
        message: 'Referral code processed',
        // Don't reveal actual reward - use placeholder
        reward_amount: 0,
      });
    }

    // Don't allow self-referral
    if (new_user_id && referrer.id === new_user_id) {
      return NextResponse.json({ error: 'Cannot refer yourself' }, { status: 400 });
    }

    // Check if this user was already referred
    if (new_user_id) {
      const { data: existingReferral } = await supabase
        .from('referrals')
        .select('id')
        .eq('referred_id', new_user_id)
        .single();

      if (existingReferral) {
        return NextResponse.json({ error: 'User already has a referrer' }, { status: 400 });
      }
    }

    // Calculate reward based on tier
    const newCount = (referrer.referral_count || 0) + 1;
    const tier = getCurrentTier(newCount);
    const rewardAmount = tier?.reward || 50;

    // Create referral record
    const { data: referral, error: createError } = await supabase
      .from('referrals')
      .insert({
        referrer_id: referrer.id,
        referred_id: new_user_id || null,
        referral_code: referral_code.toUpperCase(),
        status: new_user_id ? 'completed' : 'pending',
        reward_amount: rewardAmount,
        completed_at: new_user_id ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (createError) {
      console.error('[REFERRAL] Create error:', createError);
      return NextResponse.json({ error: 'Failed to create referral' }, { status: 500 });
    }

    // Update referrer's count
    await supabase
      .from('users')
      .update({
        referral_count: newCount,
      })
      .eq('id', referrer.id);

    // Update referred user's referred_by field
    if (new_user_id) {
      await supabase
        .from('users')
        .update({ referred_by: referrer.id })
        .eq('id', new_user_id);
    }

    return NextResponse.json({
      success: true,
      referral_id: referral.id,
      reward_amount: rewardAmount,
      message: `Referral tracked! ${rewardAmount} XP reward earned.`,
    });

  } catch (error) {
    console.error('[REFERRAL] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function generateReferralCode(userId: string): string {
  // Generate a readable 8-character code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O/1/I to avoid confusion
  const hash = userId.replace(/-/g, '').toUpperCase();
  let code = '';
  for (let i = 0; i < 8; i++) {
    const index = parseInt(hash.charAt(i * 4) || '0', 16) % chars.length;
    code += chars[index];
  }
  return code;
}
