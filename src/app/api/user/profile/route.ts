// /api/user/profile
// Get current user profile

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import crypto from 'crypto';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getUserKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return crypto.createHash('sha256').update(ip + ua).digest('hex');
}

export async function GET(req: NextRequest) {
  // Rate limiting - 60 requests per minute
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userKey = getUserKey(req);

    // Try to get session
    let email = null;
    try {
      const session = await getServerSession();
      if (session?.user?.email) {
        email = session.user.email;
      }
    } catch {
      // No session
    }

    // Try to find user by email first, then by device key
    let user = null;

    if (email) {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single();
      user = data;
    }

    if (!user) {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('device_key', userKey)
        .single();
      user = data;
    }

    if (!user) {
      return NextResponse.json({
        exists: false,
        user: null,
      });
    }

    return NextResponse.json({
      exists: true,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        bio: user.bio,
        avatar_url: user.avatar_url,
        level: user.level,
        xp: user.xp,
        total_votes_cast: user.total_votes_cast,
        total_votes_received: user.total_votes_received,
        clips_uploaded: user.clips_uploaded,
        clips_locked: user.clips_locked,
        followers_count: user.followers_count,
        following_count: user.following_count,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('Get profile error:', err);
    return NextResponse.json({ exists: false, user: null, error: 'Server error' }, { status: 500 });
  }
}
