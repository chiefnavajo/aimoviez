// Temporary debug endpoint to check prompt_history
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';

export async function GET(req: NextRequest) {
  // Allow admin session auth
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return NextResponse.json({ error: 'Missing Supabase config', hasUrl: !!url, hasKey: !!key });
  }

  const supabase = createClient(url, key);

  // Direct query
  const { data, error, count } = await supabase
    .from('prompt_history')
    .select('id, user_prompt, scene_elements', { count: 'exact' })
    .is('scene_elements', null)
    .limit(5);

  return NextResponse.json({
    ok: true,
    queryError: error?.message || null,
    count,
    prompts: data?.map(p => ({
      id: p.id,
      hasPrompt: !!p.user_prompt,
      promptLength: p.user_prompt?.length,
      hasElements: p.scene_elements !== null
    })),
  });
}
