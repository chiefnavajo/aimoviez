// lib/admin-auth.ts
// ============================================================================
// ADMIN AUTHENTICATION HELPER
// Verifies that the current user is an admin
// ============================================================================

import { getServerSession } from 'next-auth';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth-options';

// ============================================================================
// TYPES
// ============================================================================

export interface AdminAuthResult {
  isAdmin: boolean;
  userId: string | null;
  email: string | null;
  error?: string;
}

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

// ============================================================================
// CHECK IF USER IS ADMIN
// ============================================================================

/**
 * Checks if the current session user is an admin
 * Returns admin status and user info
 */
export async function checkAdminAuth(): Promise<AdminAuthResult> {
  try {
    // Get session with authOptions
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return {
        isAdmin: false,
        userId: null,
        email: null,
        error: 'Not authenticated',
      };
    }

    const email = session.user.email;
    const supabase = getSupabaseClient();

    // Check if user exists and is admin
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, is_admin')
      .eq('email', email)
      .single();

    if (error || !user) {
      return {
        isAdmin: false,
        userId: null,
        email,
        error: 'User not found in database',
      };
    }

    return {
      isAdmin: user.is_admin === true,
      userId: user.id,
      email: user.email,
    };
  } catch (error) {
    console.error('[admin-auth] Error checking admin status:', error);
    return {
      isAdmin: false,
      userId: null,
      email: null,
      error: 'Failed to verify admin status',
    };
  }
}

// ============================================================================
// REQUIRE ADMIN MIDDLEWARE
// ============================================================================

/**
 * Returns an error response if user is not an admin
 * Use at the start of admin API routes
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const auth = await checkAdminAuth();

  if (!auth.isAdmin) {
    console.warn('[admin-auth] Unauthorized admin access attempt');

    if (!auth.email) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication required',
          message: 'You must be logged in to access this resource',
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Admin access required',
        message: 'You do not have permission to access this resource',
      },
      { status: 403 }
    );
  }

  // User is admin, return null to indicate success
  return null;
}
