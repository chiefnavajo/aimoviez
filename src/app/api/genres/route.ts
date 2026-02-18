// app/api/genres/route.ts
// Głosowanie na gatunek kolejnego sezonu (Season 2, 3, ...)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';

function createSupabaseServerClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      '[genres] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables'
    );
  }

  return createClient(supabaseUrl, supabaseKey);
}

// Ten sam mechanizm co w /api/vote – 1 "user" = 1 urządzenie (ip+UA)
function getVoterKey(req: NextRequest): string {
  const ip =
    (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '0.0.0.0';
  const ua = req.headers.get('user-agent') || 'unknown-ua';
  const raw = `${ip}|${ua}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return `device_${hash}`;
}

// Dozwolone gatunki – możesz później rozszerzyć
const GENRE_OPTIONS = [
  { code: 'COMEDY', label: 'Comedy' },
  { code: 'THRILLER', label: 'Thriller' },
  { code: 'ACTION', label: 'Action' },
  { code: 'ANIMATION', label: 'Animation' },
  { code: 'SCI-FI', label: 'Sci-Fi' },
  { code: 'ROMANCE', label: 'Romance' },
  { code: 'HORROR', label: 'Horror' },
  { code: 'DRAMA', label: 'Drama' },
] as const;

type GenreCode = (typeof GENRE_OPTIONS)[number]['code'];

interface GenreVoteRow {
  genre_code: string;
  voter_key: string;
}

interface GenreSummaryOption {
  code: GenreCode;
  label: string;
  votes: number;
  percentage: number;
}

interface GenreSummaryResponse {
  seasonNumber: number;
  totalVotes: number;
  options: GenreSummaryOption[];
  userChoice: GenreCode | null;
}

// ====================
// GET /api/genres?season=2
// ====================

export async function GET(req: NextRequest) {
  // Rate limit
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  const supabase = createSupabaseServerClient();
  const voterKey = getVoterKey(req);

  try {
    const { searchParams } = new URL(req.url);
    const seasonParam = searchParams.get('season');
    const seasonNumber = seasonParam ? parseInt(seasonParam, 10) : 2;

    if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) {
      return NextResponse.json(
        { error: 'Invalid season number' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('genre_votes')
      .select('genre_code, voter_key')
      .eq('season_number', seasonNumber)
      .limit(10000);

    if (error) {
      console.error('[GET /api/genres] error:', error);
      return NextResponse.json(
        { error: 'Failed to load genre votes' },
        { status: 500 }
      );
    }

    const rows = (data as GenreVoteRow[]) || [];
    const totalVotes = rows.length;

    // policz głosy per gatunek w pamięci
    const counts = new Map<GenreCode, number>();
    for (const opt of GENRE_OPTIONS) {
      counts.set(opt.code, 0);
    }

    let userChoice: GenreCode | null = null;

    for (const row of rows) {
      const code = row.genre_code.toUpperCase() as GenreCode;
      if (counts.has(code)) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
      if (row.voter_key === voterKey && counts.has(code)) {
        userChoice = code;
      }
    }

    const options: GenreSummaryOption[] = GENRE_OPTIONS.map((opt) => {
      const v = counts.get(opt.code) ?? 0;
      const pct = totalVotes > 0 ? v / totalVotes : 0;
      return {
        code: opt.code,
        label: opt.label,
        votes: v,
        percentage: pct,
      };
    });

    const response: GenreSummaryResponse = {
      seasonNumber,
      totalVotes,
      options,
      userChoice,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (e) {
    console.error('[GET /api/genres] unexpected error:', e);
    return NextResponse.json(
      { error: 'Failed to load genre votes' },
      { status: 500 }
    );
  }
}

// ====================
// POST /api/genres
// Body: { genre: 'COMEDY', seasonNumber?: 2 }
// ====================

export async function POST(req: NextRequest) {
  // Rate limit
  const rateLimitResponse = await rateLimit(req, 'vote');
  if (rateLimitResponse) return rateLimitResponse;

  // CSRF protection
  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  const supabase = createSupabaseServerClient();
  const voterKey = getVoterKey(req);

  try {
    const body = await req.json();
    const genreRaw: string | undefined = body?.genre;
    const seasonNumber: number = body?.seasonNumber ?? 2;

    if (!genreRaw) {
      return NextResponse.json(
        { error: 'Missing genre' },
        { status: 400 }
      );
    }

    if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) {
      return NextResponse.json(
        { error: 'Invalid season number' },
        { status: 400 }
      );
    }

    const genre = genreRaw.toUpperCase() as GenreCode;
    const allowed = GENRE_OPTIONS.some((g) => g.code === genre);

    if (!allowed) {
      return NextResponse.json(
        { error: 'Invalid genre option' },
        { status: 400 }
      );
    }

    // Upsert – 1 głos na sezon na 1 urządzenie; zmiana wyboru = nadpisanie
    const { error } = await supabase
      .from('genre_votes')
      .upsert(
        {
          season_number: seasonNumber,
          genre_code: genre,
          voter_key: voterKey,
        },
        {
          onConflict: 'season_number,voter_key',
        }
      );

    if (error) {
      console.error('[POST /api/genres] upsert error:', error);
      return NextResponse.json(
        { error: 'Failed to save vote' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        seasonNumber,
        genre,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error('[POST /api/genres] unexpected error:', e);
    return NextResponse.json(
      { error: 'Failed to save vote' },
      { status: 500 }
    );
  }
}