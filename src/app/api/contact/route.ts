// app/api/contact/route.ts
// Handle contact form submissions

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';

// Sanitize user input to prevent XSS and injection
function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove HTML brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

const VALID_REASONS = ['general', 'support', 'bug', 'feature', 'report', 'business'];

export async function POST(request: NextRequest) {
  // Rate limit: 3 contact form submissions per minute (prevents spam)
  const rateLimitResponse = await rateLimit(request, 'contact');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);
    const body = await request.json();
    const { reason, email: rawEmail, subject: rawSubject, message: rawMessage } = body;

    // Sanitize all user inputs
    const email = sanitizeInput(rawEmail || '');
    const subject = sanitizeInput(rawSubject || '');
    const message = sanitizeInput(rawMessage || '');

    // Validation
    if (!reason || !VALID_REASONS.includes(reason)) {
      return NextResponse.json(
        { error: 'Invalid reason selected' },
        { status: 400 }
      );
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Valid email is required' },
        { status: 400 }
      );
    }

    if (!subject || subject.length < 3 || subject.length > 100) {
      return NextResponse.json(
        { error: 'Subject must be between 3 and 100 characters' },
        { status: 400 }
      );
    }

    if (!message || message.length < 10 || message.length > 2000) {
      return NextResponse.json(
        { error: 'Message must be between 10 and 2000 characters' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Store the contact submission
    const { error: insertError } = await supabase
      .from('contact_submissions')
      .insert({
        user_id: session?.user?.userId || null,
        reason,
        email,
        subject,
        message,
        user_agent: request.headers.get('user-agent') || null,
        ip_address: request.headers.get('x-forwarded-for')?.split(',')[0] || null,
        status: 'new',
      });

    if (insertError) {
      console.error('Contact submission error:', insertError);
      // If table doesn't exist, still return success (admin can check logs)
      if (insertError.code === '42P01') {
        console.log('contact_submissions table does not exist, logging to console only');
        console.log('Contact submission:', { reason, email, subject, message });
        return NextResponse.json({ success: true });
      }
      throw insertError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Contact API error:', error);
    return NextResponse.json(
      { error: 'Failed to send message. Please try again.' },
      { status: 500 }
    );
  }
}
