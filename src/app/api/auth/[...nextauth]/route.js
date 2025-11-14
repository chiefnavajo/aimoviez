import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: "select_account",   // ⬅ always show “Choose account”
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
  },
});

export { handler as GET, handler as POST };
