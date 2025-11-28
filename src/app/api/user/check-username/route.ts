// /api/user/check-username
// Check if a username is available

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const username = searchParams.get('username')?.toLowerCase().trim();

    if (!username || username.length < 3) {
      return NextResponse.json({ available: false, error: 'Username must be at least 3 characters' });
    }

    // Check for invalid characters
    if (!/^[a-z0-9_]+$/.test(username)) {
      return NextResponse.json({ available: false, error: 'Invalid characters' });
    }

    // Reserved usernames
    const reserved = ['admin', 'aimoviez', 'support', 'help', 'official', 'system', 'moderator', 'mod'];
    if (reserved.includes(username)) {
      return NextResponse.json({ available: false, error: 'Username is reserved' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('Error checking username:', error);
      return NextResponse.json({ available: false, error: 'Database error' });
    }

    return NextResponse.json({ available: !data });
  } catch (err) {
    console.error('Check username error:', err);
    return NextResponse.json({ available: false, error: 'Server error' });
  }
}
