// Temporary debug endpoint to check prompt_history
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  // Simple auth check
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
