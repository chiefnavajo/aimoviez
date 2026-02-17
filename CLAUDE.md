# AIMoviez — Project Instructions for Claude Code

## Tech Stack
- **Framework**: Next.js 15 (App Router), React 19, TypeScript
- **Database**: Supabase (Postgres + Realtime + Storage + RLS)
- **Cache/Queue**: Upstash Redis (rate limiting, vote dedup, CRDT counters, event queues)
- **Styling**: TailwindCSS v4 (via `@import "tailwindcss"`), Framer Motion
- **Auth**: NextAuth.js v4 (session-based)
- **AI**: Anthropic Claude API (narration, scripts, co-director), ElevenLabs (TTS)
- **Video**: Luma AI, Runway ML, fal.ai (AI video generation), Cloudflare R2 (storage)
- **Testing**: Jest + React Testing Library, mock-based (no real services)
- **Validation**: Zod v4 schemas in `src/lib/validations.ts`
- **Hosting**: Vercel (Next.js), Cloudflare Worker (video proxy)

## Key Conventions

### API Routes (`src/app/api/`)
- Pattern: `src/app/api/[domain]/route.ts` exporting GET/POST/DELETE etc.
- Supabase clients: `getServiceClient()` (admin/writes), `getAnonClient()` (reads/RLS) from `@/lib/supabase-client`
- Admin guard: `requireAdmin()` from `@/lib/admin-auth` — returns NextResponse error or null
- Cron guard: `verifyCronAuth(authHeader)` from `@/lib/cron-auth` — timing-safe Bearer token check
- Rate limiting: `rateLimit()` from `@/lib/rate-limit` on all public endpoints
- CSRF: `requireCsrf()` from `@/lib/csrf` on all mutation endpoints
- Error responses: `errorResponse(API_ERRORS.XXX)`, `handleUnexpectedError()` from `@/lib/api-errors` — never leak internal errors
- Validation: Zod schemas from `@/lib/validations` — `VoteRequestSchema`, `RegisterClipSchema`, etc.
- Device identity: `generateDeviceKey()` from `@/lib/device-fingerprint` (voter_key = `user_${userId}`)

### Architecture Rules
- No real DB/Redis in unit tests — mock with `createSupabaseChain()` from `src/__tests__/helpers/api-test-utils.ts`
- Touch handlers: `useRef` not `useState` (prevents re-renders on every touchMove)
- Infinite animations: CSS `@keyframes` not Framer Motion `repeat: Infinity` (compositor vs main thread)
- Mobile overlays: No `backdrop-filter: blur()` over video elements (GPU killer)
- Video preload: `"metadata"` on mobile, `"auto"` on desktop
- Next.js 15 dynamic route params: `Promise<{ id: string }>` not `{ id: string }`
- Supabase: `.maybeSingle()` for optional rows, `.single()` only when row guaranteed
- Redis CRDT: always `forceSyncCounters()` before reading winner scores

### Testing
- `npm run test:fixes` — 69 regression tests (8 suites) for bug fixes
- `npm run test` — All unit tests
- `npm run test:integration` — Integration tests (needs real Supabase/Redis)
- Test environment: `@jest-environment node` for API route tests, `jsdom` for hook/component tests
- After `jest.resetModules()`, use `require()` to get fresh mock references

## Database Tables (Supabase)
**Core**: users, tournament_clips, votes, story_slots, seasons, comments, comment_likes
**Teams**: teams, team_members, team_messages, team_invites
**System**: cron_locks, push_subscriptions, notifications, referrals, clip_views
**AI Movie**: movie_projects, movie_scenes
**Config**: feature_flags, credit_transactions, user_credits

## External Services
- **Supabase**: Postgres DB, Realtime channels, Storage buckets, RPC functions
- **Upstash Redis**: Rate limiting, vote dedup, CRDT counters, event queues, leaderboard cache
- **Anthropic Claude**: AI narration (`/api/ai/narrate`), script generation, co-director analysis
- **ElevenLabs**: Text-to-speech for story narration
- **Luma AI / Runway ML / fal.ai**: AI video generation for movie scenes
- **Cloudflare**: R2 storage + Worker proxy for video delivery
- **Vercel**: Hosting, cron jobs, analytics
- **Sentry**: Error tracking (`@sentry/nextjs`)

## Project Structure Overview
```
src/
├── app/              # Next.js App Router pages + API routes
│   ├── api/          # 125 API routes (admin, cron, vote, teams, ai, etc.)
│   ├── story/        # Main story/voting page (TikTok-style vertical swipe)
│   ├── movie/        # AI movie generation pages
│   ├── teams/        # Dream Teams feature
│   └── admin/        # Admin dashboard
├── components/       # 33 React components
├── hooks/            # 18 custom hooks (realtime, auth, features)
├── lib/              # 43 utility modules (DB, Redis, AI, auth, validation)
└── __tests__/        # Jest tests (api, hooks, helpers, integration)
```
