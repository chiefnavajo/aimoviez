// /api/user/create-profile
// Create a new user profile after Google login

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import crypto from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getUserKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return crypto.createHash('sha256').update(ip + ua).digest('hex');
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    const userKey = getUserKey(req);

    const { username, display_name, bio, avatar_url } = body;

    // Validation
    if (!username || username.length < 3) {
      return NextResponse.json({ success: false, error: 'Username must be at least 3 characters' }, { status: 400 });
    }

    if (!/^[a-z0-9_]+$/.test(username)) {
      return NextResponse.json({ success: false, error: 'Invalid username format' }, { status: 400 });
    }

    // SECURITY: Require authentication to create a profile
    // This prevents account spoofing and ensures email ownership
    let email = null;
    let googleId = null;
    try {
      const session = await getServerSession();
      if (session?.user?.email) {
        email = session.user.email;
        googleId = session.user.email; // Use email as google_id for simplicity
      }
    } catch {
      // No session
    }

    // Require authentication - anonymous profile creation is disabled
    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required. Please sign in with Google first.' },
        { status: 401 }
      );
    }

    // Check if this email already has a profile
    const { data: existingByEmail } = await supabase
      .from('users')
      .select('id, username')
      .eq('email', email)
      .single();

    if (existingByEmail) {
      return NextResponse.json(
        { success: false, error: 'Profile already exists for this account', existingUsername: existingByEmail.username },
        { status: 409 }
      );
    }

    // Check if username exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .single();

    if (existing) {
      return NextResponse.json({ success: false, error: 'Username already taken' }, { status: 400 });
    }

    // Create user
    const { data: user, error } = await supabase
      .from('users')
      .insert({
        username,
        display_name: display_name || username,
        bio: bio || null,
        avatar_url: avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
        email: email,
        google_id: googleId,
        device_key: userKey,
        level: 1,
        xp: 0,
        total_votes_cast: 0,
        total_votes_received: 0,
        clips_uploaded: 0,
        clips_locked: 0,
        followers_count: 0,
        following_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Create profile error:', error);
      return NextResponse.json({ success: false, error: 'Failed to create profile' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        bio: user.bio,
        avatar_url: user.avatar_url,
        level: user.level,
      },
    });
  } catch (err) {
    console.error('Create profile error:', err);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}
