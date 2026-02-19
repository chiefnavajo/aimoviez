// app/api/ai/characters/[id]/generate-angles/route.ts
// Auto-generate left/right/rear reference angles from a frontal photo using Kling O1 Image

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // fal.ai generation (3 parallel) + download + upload

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { generateCharacterAngle, ANGLE_PROMPTS } from '@/lib/ai-video';
import { getStorageProvider, getSignedUploadUrl } from '@/lib/storage';
import crypto from 'crypto';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

/**
 * POST /api/ai/characters/{id}/generate-angles
 * Auto-generate 3 reference angle views from the frontal photo.
 * Requires auto_generate_angles feature flag to be enabled.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const rateLimitResponse = await rateLimit(req, 'upload');
  if (rateLimitResponse) return rateLimitResponse;
  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id: characterId } = await context.params;
    const supabase = getSupabase();

    // Check feature flag — allow if either user_characters or auto_generate_angles is enabled
    const { data: flags } = await supabase
      .from('feature_flags')
      .select('key, enabled')
      .in('key', ['user_characters', 'auto_generate_angles']);

    const flagMap = Object.fromEntries((flags ?? []).map(f => [f.key, f.enabled]));
    if (!flagMap['user_characters'] && !flagMap['auto_generate_angles']) {
      return NextResponse.json(
        { success: false, error: 'Angle generation is not enabled' },
        { status: 403 }
      );
    }

    // Get user
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Get character (with ownership check)
    const { data: character } = await supabase
      .from('user_characters')
      .select('id, frontal_image_url, reference_image_urls')
      .eq('id', characterId)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!character) {
      return NextResponse.json(
        { success: false, error: 'Character not found or not owned by you' },
        { status: 404 }
      );
    }

    // Parse optional body for clear_existing flag
    let clearExisting = false;
    try {
      const body = await req.json();
      clearExisting = body?.clear_existing === true;
    } catch {
      // No body is fine — defaults to false
    }

    // Skip if character already has reference angles (unless regenerating)
    const existingCount = character.reference_image_urls?.length ?? 0;
    if (existingCount >= 3 && !clearExisting) {
      return NextResponse.json({
        ok: true,
        reference_count: existingCount,
        reference_image_urls: character.reference_image_urls || [],
        skipped: true,
        message: 'Character already has reference angles',
      });
    }

    // Clear existing angles for regeneration
    if (clearExisting && existingCount > 0) {
      const { error: clearError } = await supabase
        .rpc('clear_user_character_angles', {
          p_id: characterId,
          p_user_id: user.id,
        });
      if (clearError) {
        console.error('[generate-angles] Failed to clear existing angles:', clearError);
        return NextResponse.json({ success: false, error: 'Failed to clear existing angles' }, { status: 500 });
      }
      console.log(`[generate-angles] Cleared ${existingCount} existing angles for regeneration`);
    }

    // Determine storage provider
    const { data: r2Flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'r2_storage')
      .maybeSingle();
    const provider = await getStorageProvider(r2Flag?.enabled ?? false);

    // Generate 3 angles in parallel
    console.log(`[generate-angles] Generating ${ANGLE_PROMPTS.length} angles for character ${characterId}, frontal: ${character.frontal_image_url?.substring(0, 80)}...`);
    const angleResults = await Promise.allSettled(
      ANGLE_PROMPTS.map((prompt, idx) => {
        console.log(`[generate-angles] Starting angle ${idx}: ${prompt.substring(0, 40)}...`);
        return generateCharacterAngle(character.frontal_image_url, prompt);
      })
    );
    console.log(`[generate-angles] fal.ai results:`, angleResults.map((r, i) => r.status === 'fulfilled' ? `angle${i}=OK` : `angle${i}=FAILED: ${r.reason}`).join(', '));

    let successCount = 0;

    for (let i = 0; i < angleResults.length; i++) {
      const result = angleResults[i];
      if (result.status === 'rejected') {
        console.error(`[generate-angles] Angle ${i} failed:`, result.reason);
        continue;
      }

      const falImageUrl = result.value;

      try {
        // Download the generated image from fal.ai
        const imageRes = await fetch(falImageUrl, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!imageRes.ok) {
          console.error(`[generate-angles] Failed to download angle ${i}: HTTP ${imageRes.status}`);
          continue;
        }
        const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
        const contentType = imageRes.headers.get('content-type') || 'image/png';

        // Upload to our storage
        const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'png';
        const uniqueFilename = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const uploadResult = await getSignedUploadUrl(uniqueFilename, contentType, provider, 'user-characters/');

        const uploadRes = await fetch(uploadResult.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: imageBuffer,
        });

        if (!uploadRes.ok) {
          console.error(`[generate-angles] Failed to upload angle ${i}: HTTP ${uploadRes.status}`);
          continue;
        }

        // Append to character via RPC
        const { data: rpcResult, error: rpcError } = await supabase.rpc('append_user_character_angle', {
          p_id: characterId,
          p_user_id: user.id,
          p_url: uploadResult.publicUrl,
          p_max_refs: 6,
        });

        if (rpcError || !rpcResult || rpcResult.length === 0) {
          console.error(`[generate-angles] RPC failed for angle ${i}:`, rpcError);
          continue;
        }

        successCount++;
      } catch (err) {
        console.error(`[generate-angles] Error processing angle ${i}:`, err);
      }
    }

    console.log(`[generate-angles] Completed: ${successCount}/${ANGLE_PROMPTS.length} angles for character ${characterId}`);

    // Fetch final reference URLs from DB for accurate response
    let finalUrls: string[] = [];
    if (successCount > 0) {
      const { data: updated } = await supabase
        .from('user_characters')
        .select('reference_image_urls')
        .eq('id', characterId)
        .single();
      finalUrls = updated?.reference_image_urls || [];
    }

    return NextResponse.json({
      ok: true,
      reference_count: finalUrls.length || (existingCount + successCount),
      reference_image_urls: finalUrls,
      generated: successCount,
    });
  } catch (err) {
    console.error('[POST /api/ai/characters/[id]/generate-angles] error:', err);
    return NextResponse.json({ success: false, error: 'Failed to generate angles' }, { status: 500 });
  }
}
