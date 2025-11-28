import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      hasProfile?: boolean;
      username?: string | null;
      userId?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    hasProfile?: boolean;
    username?: string | null;
    userId?: string | null;
  }
}
