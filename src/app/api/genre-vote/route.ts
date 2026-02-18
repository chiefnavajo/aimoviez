// app/api/genre-vote/route.ts
// Genre Voting API - Vote for next season's genre

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { GenreVoteSchema, parseBody } from '@/lib/validations';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const GENRES = [
  'Thriller',
  'Comedy',
  'Action',
  'Sci-Fi',
  'Romance',
  'Animation',
  'Horror',
  'Drama',
] as const;

type Genre = (typeof GENRES)[number];

/**
 * Generate voter key from IP + User-Agent
 */
function getVoterKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return crypto.createHash('sha256').update(ip + ua).digest('hex');
}

/**
 * Genre Vote Response
 */
interface GenreVoteResponse {
  success: boolean;
  genre: Genre;
  vote_count: number;
  percentages: Record<Genre, number>;
  user_previous_vote?: Genre;
  message?: string;
}

/**
 * GET /api/genre-vote
 * Returns current genre voting stats and user's previous vote if any
 * OPTIMIZED: Uses single RPC call instead of 7+ parallel queries
 */
export async function GET(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const voterKey = getVoterKey(req);

    // Try optimized RPC function first (single query)
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'get_genre_vote_stats',
      { p_voter_key: voterKey }
    );

    // Initialize genre counts
    const genreCounts = new Map<Genre, number>();
    GENRES.forEach((g) => genreCounts.set(g, 0));
    let userPreviousVote: Genre | undefined;

    if (rpcError) {
      // RPC not available - fall back to parallel queries
      console.warn('[GET /api/genre-vote] RPC not available, using fallback:', rpcError.code);

      const [genreCountsResult, userVoteResult] = await Promise.all([
        // Query 1: Count per genre using parallel COUNT queries
        Promise.all(
          GENRES.map(async (genre) => {
            const { count } = await supabase
              .from('genre_votes')
              .select('id', { count: 'exact', head: true })
              .eq('genre', genre);
            return { genre, count: count || 0 };
          })
        ),

        // Query 2: Get user's previous vote (single row)
        supabase
          .from('genre_votes')
          .select('genre')
          .eq('voter_key', voterKey)
          .maybeSingle(),
      ]);

      // Process count results
      genreCountsResult.forEach(({ genre, count }) => {
        if (GENRES.includes(genre as Genre)) {
          genreCounts.set(genre as Genre, count);
        }
      });

      userPreviousVote = userVoteResult.data?.genre as Genre | undefined;
    } else {
      // RPC succeeded - process results
      interface RpcRow {
        genre: string;
        vote_count: number;
        user_voted: boolean;
      }

      (rpcData as RpcRow[])?.forEach((row: RpcRow) => {
        if (GENRES.includes(row.genre as Genre)) {
          genreCounts.set(row.genre as Genre, row.vote_count);
          if (row.user_voted) {
            userPreviousVote = row.genre as Genre;
          }
        }
      });
    }

    // Calculate percentages
    const totalVotes = Array.from(genreCounts.values()).reduce((sum, count) => sum + count, 0);
    const percentages: Record<string, number> = {};

    GENRES.forEach((genre) => {
      const count = genreCounts.get(genre) || 0;
      percentages[genre] = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    });

    return NextResponse.json({
      counts: Object.fromEntries(genreCounts),
      percentages,
      total_votes: totalVotes,
      user_previous_vote: userPreviousVote,
    });
  } catch (err) {
    console.error('[GET /api/genre-vote] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/genre-vote
 * Cast or update a genre vote
 * 
 * Body: { genre: Genre }
 */
export async function POST(req: NextRequest) {
  // Rate limiting for votes
  const rateLimitResponse = await rateLimit(req, 'vote');
  if (rateLimitResponse) return rateLimitResponse;

  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const voterKey = getVoterKey(req);

    // Parse and validate body with Zod
    const body = await req.json();
    const validation = parseBody(GenreVoteSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { genre } = validation.data;

    // RACE CONDITION FIX: Use upsert instead of check-then-insert pattern
    // This is atomic and prevents duplicate votes from concurrent requests
    const { error: upsertError } = await supabase
      .from('genre_votes')
      .upsert(
        {
          voter_key: voterKey,
          genre,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'voter_key',
          ignoreDuplicates: false, // Update if exists
        }
      );

    if (upsertError) {
      console.error('[POST /api/genre-vote] upsertError:', upsertError);
      return NextResponse.json(
        { error: 'Failed to cast vote' },
        { status: 500 }
      );
    }

    // OPTIMIZED: Get updated counts using RPC (single query) with fallback
    const genreCounts = new Map<Genre, number>();
    GENRES.forEach((g) => genreCounts.set(g, 0));

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'get_genre_vote_stats',
      { p_voter_key: voterKey }
    );

    if (rpcError) {
      // Fallback to parallel queries if RPC not available
      const genreCountResults = await Promise.all(
        GENRES.map(async (g) => {
          const { count } = await supabase
            .from('genre_votes')
            .select('id', { count: 'exact', head: true })
            .eq('genre', g);
          return { genre: g, count: count || 0 };
        })
      );

      genreCountResults.forEach(({ genre, count }) => {
        genreCounts.set(genre, count);
      });
    } else {
      // Process RPC results
      interface RpcRow {
        genre: string;
        vote_count: number;
        user_voted: boolean;
      }
      (rpcData as RpcRow[])?.forEach((row: RpcRow) => {
        if (GENRES.includes(row.genre as Genre)) {
          genreCounts.set(row.genre as Genre, row.vote_count);
        }
      });
    }

    const totalVotes = Array.from(genreCounts.values()).reduce((sum, count) => sum + count, 0);
    const percentages: Record<string, number> = {};

    GENRES.forEach((g) => {
      const count = genreCounts.get(g) || 0;
      percentages[g] = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    });

    const response: GenreVoteResponse = {
      success: true,
      genre,
      vote_count: genreCounts.get(genre) || 0,
      percentages: percentages as Record<Genre, number>,
      user_previous_vote: genre, // With upsert, we don't know if it was an update or insert
      message: 'Vote recorded successfully',
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[POST /api/genre-vote] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/genre-vote
 * Remove user's genre vote
 */
export async function DELETE(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'vote');
  if (rateLimitResponse) return rateLimitResponse;

  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const voterKey = getVoterKey(req);

    const { error } = await supabase
      .from('genre_votes')
      .delete()
      .eq('voter_key', voterKey);

    if (error) {
      console.error('[DELETE /api/genre-vote] deleteError:', error);
      return NextResponse.json(
        { error: 'Failed to remove vote' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Vote removed successfully',
    });
  } catch (err) {
    console.error('[DELETE /api/genre-vote] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
