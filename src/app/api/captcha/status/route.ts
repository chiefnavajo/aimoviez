// app/api/captcha/status/route.ts
// Check if CAPTCHA is required for voting

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ required: false });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: captchaFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'require_captcha_voting')
      .maybeSingle();

    const required = captchaFlag?.enabled ?? false;
    const configured = !!process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;

    return NextResponse.json({
      required: required && configured,
      configured,
    });
  } catch {
    return NextResponse.json({ required: false, configured: false });
  }
}
