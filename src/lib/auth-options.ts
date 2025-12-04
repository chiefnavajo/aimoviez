// lib/auth-options.ts
// NextAuth configuration options - shared between route handler and server functions

import GoogleProvider from "next-auth/providers/google";
import { createClient } from "@supabase/supabase-js";
import type { NextAuthOptions } from "next-auth";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,

  // Session security configuration
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours (reduced from 7 days for security)
    updateAge: 60 * 60, // Refresh session every 1 hour
  },

  // Secure cookie configuration
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production'
        ? '__Secure-next-auth.session-token'
        : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },

  // Security pages
  pages: {
    signIn: '/', // Redirect to home for sign in
    error: '/', // Redirect to home on error
  },
  callbacks: {
    async signIn({ user }) {
      const raw = process.env.ALLOWED_EMAILS || "";

      const allowed = raw
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      if (!allowed.length) {
        console.warn("⚠️ No ALLOWED_EMAILS set – allowing all users");
        return true;
      }

      if (!user?.email) {
        console.error("❌ No email in user object");
        return false;
      }

      const isAllowed = allowed.includes(user.email.toLowerCase());
      if (!isAllowed) {
        console.error("❌ User not in allowlist:", user.email);
      }

      return isAllowed;
    },

    async jwt({ token, user, account }) {
      // Set email on initial sign in
      if (account && user) {
        token.email = user.email;
      }

      // Check profile status on every request if we have an email
      if (token.email && supabaseUrl && supabaseKey) {
        try {
          const supabase = createClient(supabaseUrl, supabaseKey);

          const { data, error } = await supabase
            .from("users")
            .select("id, username")
            .eq("email", token.email)
            .single();

          if (error && error.code !== "PGRST116") {
            console.error("⚠️ Error checking user profile:", error.message);
          }

          token.hasProfile = !!data;
          token.username = data?.username || null;
          token.userId = data?.id || null;
        } catch (err) {
          console.error("❌ Could not check user profile:", err);
          token.hasProfile = false;
        }
      } else if (!supabaseUrl || !supabaseKey) {
        if (!token._supabaseWarningLogged) {
          console.error("❌ Supabase credentials missing!");
          token._supabaseWarningLogged = true;
        }
        token.hasProfile = false;
      }

      return token;
    },

    async session({ session, token }) {
      // Add profile info to session
      session.user.hasProfile = token.hasProfile || false;
      session.user.username = token.username || null;
      session.user.userId = token.userId || null;

      return session;
    },

    async redirect({ url, baseUrl }) {
      if (url === baseUrl || url === `${baseUrl}/`) {
        return `${baseUrl}/dashboard`;
      }

      const finalUrl = url.startsWith(baseUrl) ? url : baseUrl;
      return finalUrl;
    },
  },
};
