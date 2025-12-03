// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth-options";

const handler = NextAuth(authOptions);

export const GET = handler;
export const POST = handler;

// Force dynamic rendering to avoid caching issues
export const dynamic = 'force-dynamic';
