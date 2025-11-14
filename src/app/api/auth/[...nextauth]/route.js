import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ user }) {
      const allowedEmail = (process.env.ALLOWED_GOOGLE_EMAIL || "").toLowerCase();

      console.log("SIGNIN ATTEMPT", user?.email, "ALLOWED:", allowedEmail);

      if (!user?.email) return false;
      return user.email.toLowerCase() === allowedEmail;
    },
  },
});

export { handler as GET, handler as POST };
