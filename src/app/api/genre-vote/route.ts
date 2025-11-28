// app/api/genre-vote/route.ts
// Genre Voting API - Vote for next season's genre

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const voterKey = getVoterKey(req);

    // Get all genre votes
    const { data: votes, error: votesError } = await supabase
      .from('genre_votes')
      .select('genre, voter_key');

    if (votesError) {
      console.error('[GET /api/genre-vote] votesError:', votesError);
      return NextResponse.json(
        { error: 'Failed to fetch genre votes' },
        { status: 500 }
      );
    }

    // Count votes per genre
    const genreCounts = new Map<Genre, number>();
    GENRES.forEach((g) => genreCounts.set(g, 0));

    let userPreviousVote: Genre | undefined;

    votes?.forEach((vote) => {
      const genre = vote.genre as Genre;
      if (GENRES.includes(genre)) {
        genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
      }
      if (vote.voter_key === voterKey) {
        userPreviousVote = genre;
      }
    });

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
  } catch (err: any) {
    console.error('[GET /api/genre-vote] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
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
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const voterKey = getVoterKey(req);

    // Parse body
    const body = await req.json();
    const { genre } = body;

    // Validate genre
    if (!genre || !GENRES.includes(genre)) {
      return NextResponse.json(
        { error: 'Invalid genre. Must be one of: ' + GENRES.join(', ') },
        { status: 400 }
      );
    }

    // Check if user has already voted
    const { data: existingVote } = await supabase
      .from('genre_votes')
      .select('*')
      .eq('voter_key', voterKey)
      .maybeSingle();

    if (existingVote) {
      // Update existing vote
      const { error: updateError } = await supabase
        .from('genre_votes')
        .update({ genre, updated_at: new Date().toISOString() })
        .eq('voter_key', voterKey);

      if (updateError) {
        console.error('[POST /api/genre-vote] updateError:', updateError);
        return NextResponse.json(
          { error: 'Failed to update vote' },
          { status: 500 }
        );
      }
    } else {
      // Insert new vote
      const { error: insertError } = await supabase.from('genre_votes').insert({
        voter_key: voterKey,
        genre,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (insertError) {
        console.error('[POST /api/genre-vote] insertError:', insertError);
        return NextResponse.json(
          { error: 'Failed to cast vote' },
          { status: 500 }
        );
      }
    }

    // Get updated counts
    const { data: allVotes } = await supabase.from('genre_votes').select('genre');

    const genreCounts = new Map<Genre, number>();
    GENRES.forEach((g) => genreCounts.set(g, 0));

    allVotes?.forEach((vote) => {
      const g = vote.genre as Genre;
      if (GENRES.includes(g)) {
        genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
      }
    });

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
      user_previous_vote: existingVote?.genre,
      message: existingVote ? 'Vote updated successfully' : 'Vote cast successfully',
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error('[POST /api/genre-vote] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/genre-vote
 * Remove user's genre vote
 */
export async function DELETE(req: NextRequest) {
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
  } catch (err: any) {
    console.error('[DELETE /api/genre-vote] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
