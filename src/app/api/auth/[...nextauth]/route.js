import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ user }) {
      const allowed = (process.env.ALLOWED_EMAILS || "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      if (!user?.email) return false;
      return allowed.includes(user.email.toLowerCase());
    },
  },
});

export { handler as GET, handler as POST };

