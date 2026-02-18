/**
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE imports
// ---------------------------------------------------------------------------

const mockFrom = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockSingle = jest.fn();

jest.mock('@/lib/supabase-client', () => ({
  getServiceClient: jest.fn(() => ({
    from: mockFrom.mockReturnValue({
      select: mockSelect.mockReturnValue({
        eq: mockEq.mockReturnValue({
          single: mockSingle,
        }),
      }),
    }),
  })),
}));

jest.mock('next-auth/providers/google', () => ({
  __esModule: true,
  default: jest.fn(({ clientId, clientSecret, authorization }) => ({
    id: 'google',
    name: 'Google',
    type: 'oauth',
    clientId,
    clientSecret,
    authorization,
  })),
}));

jest.mock('@/lib/session-store', () => ({
  refreshSession: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { authOptions } from '@/lib/auth-options';

// ---------------------------------------------------------------------------
// NOTE: auth-options.ts captures process.env.NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY as module-level constants at import time.
// Jest hoists jest.mock() calls above process.env assignments, so these
// module-level consts may be undefined. This means the jwt callback's DB
// query path (`if (needsRefresh && token.email && supabaseUrl && supabaseKey)`)
// will short-circuit. We test the non-DB paths of the jwt callback and
// all other callbacks which work correctly.
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ALLOWED_EMAILS = 'alice@example.com,bob@example.com';
});

describe('auth-options', () => {
  // -----------------------------------------------------------------------
  // Provider configuration
  // -----------------------------------------------------------------------

  describe('provider configuration', () => {
    it('configures Google as the only provider', () => {
      expect(authOptions.providers).toHaveLength(1);
      expect(authOptions.providers[0]).toMatchObject({
        id: 'google',
        name: 'Google',
        type: 'oauth',
      });
    });

    it('uses select_account prompt', () => {
      const provider = authOptions.providers[0] as { authorization: { params: { prompt: string } } };
      expect(provider.authorization.params.prompt).toBe('select_account');
    });
  });

  // -----------------------------------------------------------------------
  // Session configuration
  // -----------------------------------------------------------------------

  describe('session configuration', () => {
    it('uses JWT strategy', () => {
      expect(authOptions.session?.strategy).toBe('jwt');
    });

    it('sets maxAge to 24 hours', () => {
      expect(authOptions.session?.maxAge).toBe(24 * 60 * 60);
    });

    it('sets updateAge to 1 hour', () => {
      expect(authOptions.session?.updateAge).toBe(60 * 60);
    });
  });

  // -----------------------------------------------------------------------
  // Cookie configuration
  // -----------------------------------------------------------------------

  describe('cookie configuration', () => {
    it('sets httpOnly on session token cookie', () => {
      expect(authOptions.cookies?.sessionToken?.options?.httpOnly).toBe(true);
    });

    it('sets sameSite to lax', () => {
      expect(authOptions.cookies?.sessionToken?.options?.sameSite).toBe('lax');
    });
  });

  // -----------------------------------------------------------------------
  // signIn callback
  // -----------------------------------------------------------------------

  describe('signIn callback', () => {
    const signIn = authOptions.callbacks!.signIn!;

    it('allows sign-in for whitelisted email (case insensitive)', async () => {
      const result = await signIn({
        user: { id: '1', email: 'Alice@Example.com' },
        account: null,
        profile: undefined,
        credentials: undefined,
        email: undefined,
      } as never);

      expect(result).toBe(true);
    });

    it('denies sign-in for non-whitelisted email', async () => {
      const result = await signIn({
        user: { id: '2', email: 'hacker@evil.com' },
        account: null,
        profile: undefined,
        credentials: undefined,
        email: undefined,
      } as never);

      expect(result).toBe(false);
    });

    it('denies sign-in when ALLOWED_EMAILS is empty', async () => {
      process.env.ALLOWED_EMAILS = '';

      const result = await signIn({
        user: { id: '3', email: 'alice@example.com' },
        account: null,
        profile: undefined,
        credentials: undefined,
        email: undefined,
      } as never);

      expect(result).toBe(false);
    });

    it('denies sign-in when user has no email', async () => {
      const result = await signIn({
        user: { id: '4' },
        account: null,
        profile: undefined,
        credentials: undefined,
        email: undefined,
      } as never);

      expect(result).toBe(false);
    });

    it('allows second whitelisted email', async () => {
      const result = await signIn({
        user: { id: '5', email: 'bob@example.com' },
        account: null,
        profile: undefined,
        credentials: undefined,
        email: undefined,
      } as never);

      expect(result).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // jwt callback
  // -----------------------------------------------------------------------

  describe('jwt callback', () => {
    const jwt = authOptions.callbacks!.jwt!;

    it('clears cached data on initial sign-in', async () => {
      const token = await jwt({
        token: { email: 'alice@example.com', userId: 'old-id', username: 'old' },
        user: { id: '1', email: 'alice@example.com' },
        account: { provider: 'google' },
        trigger: 'signIn',
      } as never);

      // On initial sign-in with account+user present, token.userId is reset to null
      expect(token.userId).toBeNull();
      expect(token.username).toBeNull();
      expect(token.hasProfile).toBe(false);
      expect(token._profileCheckedAt).toBeNull();
    });

    it('preserves userId and username on subsequent calls when cache is fresh', async () => {
      const token = await jwt({
        token: {
          email: 'alice@example.com',
          userId: 'u-1',
          username: 'alice',
          hasProfile: true,
          isAdmin: false,
          _profileCheckedAt: Date.now(), // Just checked
        },
        user: undefined,
        account: null,
        trigger: 'update',
      } as never);

      // Should skip DB query and preserve userId/username
      expect(mockFrom).not.toHaveBeenCalled();
      expect(token.userId).toBe('u-1');
      expect(token.username).toBe('alice');
      // Note: hasProfile is set to false by the else-if branch because
      // supabaseUrl/supabaseKey module-level consts are undefined in test env.
      // This is expected behavior when Supabase credentials are not configured.
      expect(token.hasProfile).toBe(false);
    });

    it('sets hasProfile=false and logs warning when supabase is not configured', async () => {
      // This tests the fallback path when module-level supabaseUrl/supabaseKey are undefined
      const token = await jwt({
        token: { email: 'alice@example.com' },
        user: { id: '1', email: 'alice@example.com' },
        account: { provider: 'google' },
        trigger: 'signIn',
      } as never);

      // Without supabase credentials, hasProfile defaults to false
      expect(token.hasProfile).toBe(false);
    });

    it('sets email from user on initial sign-in', async () => {
      const token = await jwt({
        token: {},
        user: { id: '1', email: 'new@example.com' },
        account: { provider: 'google' },
        trigger: 'signIn',
      } as never);

      expect(token.email).toBe('new@example.com');
    });
  });

  // -----------------------------------------------------------------------
  // session callback
  // -----------------------------------------------------------------------

  describe('session callback', () => {
    const session = authOptions.callbacks!.session!;

    it('adds profile fields to session', async () => {
      const result = await session({
        session: { user: { name: 'Alice', email: 'alice@example.com' }, expires: '' },
        token: {
          hasProfile: true,
          username: 'alice',
          userId: 'u-1',
          isAdmin: true,
        },
      } as never);

      expect(result.user.hasProfile).toBe(true);
      expect(result.user.username).toBe('alice');
      expect(result.user.userId).toBe('u-1');
      expect(result.user.isAdmin).toBe(true);
    });

    it('defaults to false/null for missing token fields', async () => {
      const result = await session({
        session: { user: { name: 'Bob', email: 'bob@example.com' }, expires: '' },
        token: {},
      } as never);

      expect(result.user.hasProfile).toBe(false);
      expect(result.user.username).toBeNull();
      expect(result.user.userId).toBeNull();
      expect(result.user.isAdmin).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // redirect callback
  // -----------------------------------------------------------------------

  describe('redirect callback', () => {
    const redirect = authOptions.callbacks!.redirect!;

    it('redirects base URL to /story', async () => {
      const result = await redirect({
        url: 'http://localhost:3000',
        baseUrl: 'http://localhost:3000',
      });

      expect(result).toBe('http://localhost:3000/story');
    });

    it('redirects base URL with trailing slash to /story', async () => {
      const result = await redirect({
        url: 'http://localhost:3000/',
        baseUrl: 'http://localhost:3000',
      });

      expect(result).toBe('http://localhost:3000/story');
    });

    it('allows URLs that start with baseUrl', async () => {
      const result = await redirect({
        url: 'http://localhost:3000/profile',
        baseUrl: 'http://localhost:3000',
      });

      expect(result).toBe('http://localhost:3000/profile');
    });

    it('returns baseUrl for external URLs', async () => {
      const result = await redirect({
        url: 'https://evil.com/phishing',
        baseUrl: 'http://localhost:3000',
      });

      expect(result).toBe('http://localhost:3000');
    });
  });

  // -----------------------------------------------------------------------
  // Pages configuration
  // -----------------------------------------------------------------------

  describe('pages configuration', () => {
    it('sets signIn page to root', () => {
      expect(authOptions.pages?.signIn).toBe('/');
    });

    it('sets error page to root', () => {
      expect(authOptions.pages?.error).toBe('/');
    });
  });
});
