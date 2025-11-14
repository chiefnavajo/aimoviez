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
      const raw = process.env.ALLOWED_GOOGLE_EMAIL || "";

      // obsługa 1 lub wielu maili, z trim() i lowercase
      const allowed = raw
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);

      console.log("SIGNIN ATTEMPT", {
        email: user?.email,
        allowed,
      });

      // jeśli nie skonfigurowałeś jeszcze env, nie blokujemy nikogo
      if (!allowed.length) {
        console.warn("No ALLOWED_GOOGLE_EMAIL set – allowing all users");
        return true;
      }

      if (!user?.email) return false;

      return allowed.includes(user.email.toLowerCase());
    },
  },
});

export { handler as GET, handler as POST };
