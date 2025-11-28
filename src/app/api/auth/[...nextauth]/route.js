import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ user }) {
      const raw = process.env.ALLOWED_EMAILS || "";

      const allowed = raw
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      console.log("SIGNIN ATTEMPT", {
        email: user?.email,
        allowed,
      });

      if (!allowed.length) {
        console.warn("No ALLOWED_EMAILS set – allowing all users");
        return true;
      }

      if (!user?.email) return false;

      return allowed.includes(user.email.toLowerCase());
    },

    async jwt({ token, user, account }) {
      // On initial sign in, check if user has profile
      if (account && user) {
        token.email = user.email;
        
        // Check if user exists in database
        if (supabaseUrl && supabaseKey) {
          try {
            const supabase = createClient(supabaseUrl, supabaseKey);
            const { data } = await supabase
              .from("users")
              .select("id, username")
              .eq("email", user.email)
              .single();
            
            token.hasProfile = !!data;
            token.username = data?.username || null;
            token.userId = data?.id || null;
          } catch (err) {
            console.log("Could not check user profile:", err);
            token.hasProfile = false;
          }
        }
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
      // After sign in, let the client handle redirect based on profile status
      return url.startsWith(baseUrl) ? url : baseUrl;
    },
  },
});

export { handler as GET, handler as POST };
