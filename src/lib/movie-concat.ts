// lib/movie-concat.ts
// Concatenate individual scene videos into a single final movie MP4
// Server-only — uses ffmpeg-static

import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';
import { writeFile, readFile, unlink } from 'fs/promises';
import { getStorageProvider, getSignedUploadUrl, getPublicVideoUrl } from '@/lib/storage';

interface SceneVideo {
  scene_number: number;
  video_url: string;
}

export type ConcatResult = {
  ok: true;
  publicUrl: string;
  storageKey: string;
  totalDurationSeconds: number;
  fileSizeMb: number;
} | {
  ok: false;
  error: string;
};

/**
 * Concatenate scene videos into a single MP4
 * Downloads all scene videos, creates ffmpeg concat list, outputs final movie
 */
export async function concatenateScenes(
  projectId: string,
  scenes: SceneVideo[]
): Promise<ConcatResult> {
  const id = crypto.randomUUID();
  const tempDir = path.join(tmpdir(), `movie_concat_${id}`);
  const concatListPath = path.join(tempDir, 'concat.txt');
  const outputPath = path.join(tempDir, 'final.mp4');
  const scenePaths: string[] = [];

  try {
    // Create temp directory
    const { mkdir } = await import('fs/promises');
    await mkdir(tempDir, { recursive: true });

    // 1. Download all scene videos
    for (const scene of scenes) {
      const scenePath = path.join(tempDir, `scene_${String(scene.scene_number).padStart(3, '0')}.mp4`);
      scenePaths.push(scenePath);

      const res = await fetch(scene.video_url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        return { ok: false, error: `Failed to download scene ${scene.scene_number}: ${res.status}` };
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      await writeFile(scenePath, buffer);
    }

    // 2. Create ffmpeg concat list
    const concatContent = scenePaths
      .map(p => `file '${p.replace(/'/g, "'\\''")}'`)
      .join('\n');
    await writeFile(concatListPath, concatContent);

    // 3. Concatenate with ffmpeg
    const ffmpegPath = (await import('ffmpeg-static')).default;
    if (!ffmpegPath) {
      return { ok: false, error: 'ffmpeg binary not found' };
    }

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    // Try copy mode first (fastest, works if all scenes have same codec)
    try {
      await execFileAsync(ffmpegPath, [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        '-y',
        outputPath,
      ], { timeout: 120_000 });
    } catch {
      // Codec mismatch — re-encode
      console.warn('[movie-concat] Copy mode failed, re-encoding...');
      await execFileAsync(ffmpegPath, [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-y',
        outputPath,
      ], { timeout: 300_000 });
    }

    // 4. Read output and upload
    const finalBuffer = await readFile(outputPath);
    const fileSizeMb = finalBuffer.length / (1024 * 1024);

    const storageProvider = await getStorageProvider(false);
    const storageKey = `movies/${projectId}/final.mp4`;
    const { signedUrl } = await getSignedUploadUrl(storageKey, 'video/mp4', storageProvider);

    const uploadRes = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: finalBuffer,
      signal: AbortSignal.timeout(60_000),
    });

    if (!uploadRes.ok) {
      return { ok: false, error: `Upload failed: ${uploadRes.status}` };
    }

    const publicUrl = getPublicVideoUrl(storageKey, storageProvider);

    // Estimate total duration (sum of scene durations)
    const totalDurationSeconds = scenes.length * 5; // Approximate

    return {
      ok: true,
      publicUrl,
      storageKey,
      totalDurationSeconds,
      fileSizeMb: Math.round(fileSizeMb * 10) / 10,
    };
  } catch (err) {
    console.error('[movie-concat] Error:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Concatenation failed',
    };
  } finally {
    // Cleanup temp files
    for (const p of scenePaths) {
      await unlink(p).catch(() => {});
    }
    await unlink(concatListPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import('fs/promises');
    await rm(tempDir, { recursive: true }).catch(() => {});
  }
}
