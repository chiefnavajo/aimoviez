import { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import ClipPageClient from './ClipPageClient';

// ============================================================================
// CLIP DETAIL PAGE - Server Component with Dynamic OG Tags
// ============================================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface ClipMetadata {
  id: string;
  title: string;
  video_url: string;
  thumbnail_url: string;
  genre: string;
  slot_position: number;
  vote_count: number;
  user: {
    username: string;
    avatar_url: string;
  } | null;
}

async function getClipData(clipId: string): Promise<ClipMetadata | null> {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: clip, error } = await supabase
      .from('tournament_clips')
      .select(`
        id,
        title,
        video_url,
        thumbnail_url,
        genre,
        slot_position,
        vote_count,
        user:users!tournament_clips_user_id_fkey(username, avatar_url)
      `)
      .eq('id', clipId)
      .single();

    if (error || !clip) return null;

    // Handle the joined user data (Supabase returns it as an array for joins)
    const userData = Array.isArray(clip.user) ? clip.user[0] : clip.user;

    return {
      id: clip.id,
      title: clip.title,
      video_url: clip.video_url,
      thumbnail_url: clip.thumbnail_url,
      genre: clip.genre,
      slot_position: clip.slot_position,
      vote_count: clip.vote_count,
      user: userData || null,
    };
  } catch {
    return null;
  }
}

// Generate dynamic metadata for social sharing
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const clip = await getClipData(id);

  if (!clip) {
    return {
      title: 'Clip Not Found | AiMoviez',
      description: 'This clip could not be found.',
    };
  }

  const username = clip.user?.username || 'Creator';
  const title = clip.title || `Clip by @${username}`;
  const description = `${title} - ${clip.genre} clip for Slot #${clip.slot_position} by @${username}. ${clip.vote_count} votes on AiMoviez.`;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.aimoviez.app';
  const clipUrl = `${siteUrl}/clip/${clip.id}`;

  // Use thumbnail or fallback to a frame from video
  const imageUrl = clip.thumbnail_url || `${siteUrl}/icons/og-default.png`;

  return {
    title: `${title} | AiMoviez`,
    description,
    openGraph: {
      title: `${title} | AiMoviez`,
      description,
      url: clipUrl,
      siteName: 'AiMoviez',
      type: 'video.other',
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      videos: clip.video_url
        ? [
            {
              url: clip.video_url,
              width: 720,
              height: 1280,
              type: 'video/mp4',
            },
          ]
        : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | AiMoviez`,
      description,
      images: [imageUrl],
      creator: `@${username}`,
    },
    other: {
      'og:video:type': 'video/mp4',
      'og:video:width': '720',
      'og:video:height': '1280',
    },
  };
}

// Server component that renders the client component
export default async function ClipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClipPageClient clipId={id} />;
}
