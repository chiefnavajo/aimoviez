// GET /api/credits/balance
// Returns the authenticated user's current credit balance

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(request, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  // Authentication
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const supabase = getSupabase();

  // Get user balance
  const { data: user, error } = await supabase
    .from('users')
    .select('id, balance_credits, lifetime_purchased_credits')
    .eq('email', session.user.email)
    .maybeSingle();

  if (error) {
    console.error('[CREDITS_BALANCE] Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch balance' },
      { status: 500 }
    );
  }

  if (!user) {
    return NextResponse.json(
      { error: 'User not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    balance: user.balance_credits ?? 0,
    lifetime_purchased: user.lifetime_purchased_credits ?? 0,
  });
}
