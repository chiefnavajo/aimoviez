# AIMoviez — Optimized Monetization Model

## Context

Three financial analysis documents exist with different pricing models, but none match the actual codebase. The credit system DB schema is fully built (packages, model_pricing, credit_transactions, deduct/refund RPCs) but **the feature flag is OFF and Stripe is not integrated**. Recent audit work saved ~$576/mo in operational costs (Sonnet→Haiku, visual learning frame reduction). The core business tension: **free AI generation is 70%+ of all costs** — it's a free tier management problem, not an infrastructure problem.

### Current State (from codebase)
- `credit_system` feature flag: **OFF** (not live)
- **No Stripe** installed — no package.json dep, no API routes, no webhooks
- **No FAN membership** — no subscription tables, no subscription code
- **No credit UI** — no CreditBalance component, no purchase modal
- Free gen: 1/day (DB seed) with 3/day code fallback
- Voting: 200/day hardcoded
- DB packages (stale seeds): $1.99/10cr → $14.99/125cr
- Margins with current seeds: 55-75% (better than docs projected)

---

## Phase 1: Credit System Launch (Week 1-2)

### 1a. Install Stripe + Create API Routes

**New dependency:** `stripe` + `@stripe/stripe-js`

**New env vars (Vercel):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

**New files:**
- `src/app/api/credits/purchase/route.ts` — POST: create Stripe Checkout Session (mode: `payment`, metadata: user_id + package_id + credits)
- `src/app/api/credits/webhook/route.ts` — POST: verify Stripe signature, handle `checkout.session.completed`, call existing `add_credits` RPC (already has idempotency guard on `stripe_payment_intent_id`)

### 1b. Update Credit Packages

Replace stale DB seeds with optimized pricing that balances impulse buys + healthy ARPU:

| Package | Credits | Price | Bonus% | Total | $/credit | Kling Gens | Label |
|---------|---------|-------|--------|-------|----------|------------|-------|
| **Try It** | 7 | $0.99 | 0% | 7 | $0.141 | 1 | — |
| **Starter** | 25 | $2.99 | 0% | 25 | $0.120 | 3 | — |
| **Popular** | 55 | $5.99 | 10% | 60 | $0.100 | 8 | MOST POPULAR |
| **Pro** | 100 | $9.99 | 15% | 115 | $0.087 | 16 | Save 15% |
| **Studio** | 250 | $24.99 | 20% | 300 | $0.083 | 42 | Best Value |

**Margins at these prices:**

| Model | fal.ai cost | Credits | Rev @ Try It | Rev @ Studio | Margin Range |
|-------|------------|---------|-------------|-------------|-------------|
| Kling 2.6 | $0.35 | 7 | $0.99 | $0.58 | 40-64% |
| Hailuo 2.3 | $0.49 | 9 | $1.27 | $0.75 | 35-61% |
| Veo3/Sora | $0.80 | 15 | $2.12 | $1.25 | 36-62% |

**SQL to run:**
```sql
UPDATE credit_packages SET is_active = false;
INSERT INTO credit_packages (name, credits, price_cents, bonus_percent, sort_order, is_active) VALUES
  ('Try It', 7, 99, 0, 1, true),
  ('Starter', 25, 299, 0, 2, true),
  ('Popular', 55, 599, 10, 3, true),
  ('Pro', 100, 999, 15, 4, true),
  ('Studio', 250, 2499, 20, 5, true);
```
Then create Stripe Products/Prices and populate `stripe_price_id`.

### 1c. Change Free Gen to Cooldown-Based (1 per 3 days)

Replace daily counter with cooldown system. **1/day bleeds $10K/mo at 10K users. 1/3-days cuts that by 67% while keeping acquisition friction low** (new users generate Day 1, again Day 3-4, getting 2-3 hooks in first week).

**New SQL RPC:** `check_generation_cooldown(p_user_id UUID, p_cooldown_hours INT DEFAULT 72)`
- Check `MAX(created_at)` from `ai_generations WHERE credit_deducted = FALSE`
- Return TRUE if elapsed time >= cooldown, or if no previous free gen
- Respect `users.ai_daily_limit = -1` (admin unlimited override)

**Modify:** `src/app/api/ai/generate/route.ts` (lines 162-184)
- Replace `check_and_reserve_generation_v2` call with `check_generation_cooldown`
- Add `free_cooldown_hours` to `ai_video_generation` feature flag config
- Free gens restricted to Kling 2.6 only (cheapest model)

### 1d. Build Credit UI Components

**New files:**
- `src/components/CreditBalance.tsx` — Navbar credit balance display, click opens purchase modal
- `src/components/CreditPurchaseModal.tsx` — Package grid, "Popular" highlighted, first-purchase bonus indicator, Stripe Checkout redirect

**Modify:** AI generation UI to show credit cost per model, "Insufficient credits" state, purchase link

### 1e. Enable the System

```sql
UPDATE feature_flags
SET enabled = true, config = '{"stripe_enabled": true, "min_purchase_credits": 7}'
WHERE key = 'credit_system';

UPDATE feature_flags
SET config = config || '{"free_cooldown_hours": 72, "free_model": "kling-2.6"}'::jsonb
WHERE key = 'ai_video_generation';
```

### 1f. First-Purchase Bonus

50% extra credits on first buy (proven conversion mechanic). Track via `lifetime_purchased_credits` on users table (already exists). Apply bonus in `add_credits` RPC when `lifetime_purchased_credits = 0`.

---

## Phase 2: Monitor + Adjust Free Tier (Weeks 3-4)

No new code. **Operational phase** using existing admin dashboard:

1. Monitor conversion rate via `credit_transactions` (type='purchase')
2. Monitor free gen costs via `ai_generations` (credit_deducted=false)
3. **If free gen costs > 60% of credit revenue** → reduce cooldown to 1/week:
   ```sql
   UPDATE feature_flags SET config = config || '{"free_cooldown_hours": 168}'::jsonb WHERE key = 'ai_video_generation';
   ```
4. **If conversion < 2%** → activate first-purchase bonus, consider price reduction
5. **If conversion > 5%** → add $49.99 "Unlimited" pack (500cr + 30% bonus)

---

## Phase 3: FAN Membership (Month 2-3, conditional)

**Only build if Phase 1 validates:** conversion ≥ 3%, DAU:Paying ≥ 10:1, avg session ≥ 3 min.

| | FAN Monthly | FAN Annual |
|---|---|---|
| **Price** | **$4.99/mo** | **$39.99/yr** ($3.33/mo) |
| Votes/day | Unlimited | Unlimited |
| Past episodes | All | All |
| Comments/day | Unlimited | Unlimited |
| Badge + flair | Purple FAN | Purple FAN |
| Credits included/mo | 5 | 10 |

**New DB tables:** `subscriptions`, `subscription_plans`
**New API routes:** `/api/subscriptions/create`, `/api/subscriptions/manage`, `/api/subscriptions/webhook`
**Modify:** Vote limit → configurable via feature flag (200 free, unlimited FAN)

---

## Revenue Projections (Phase 1 — Credits Only, 1/3-day free)

### Assumptions
- DAU ratio: 33%, Credit buyer conversion: 4%, Avg transactions/buyer/mo: 1.5
- Weighted avg transaction: $5.60, Free gen utilization: 30% of free DAU
- Weighted avg fal.ai cost: $0.50/gen, Credit breakage: 10%
- Stripe fee: 2.9% + $0.30

| Scale | Revenue | Free Gen Cost | Paid Gen Cost | Other Costs | Profit | Margin |
|-------|---------|--------------|--------------|-------------|--------|--------|
| **1K users** | $336 | $347 | $200 | $121 | **-$332** | -99% |
| **5K users** | $1,680 | $1,733 | $1,000 | $338 | **-$1,391** | -83% |
| **10K users** | $3,360 | $3,465 | $2,000 | $636 | **-$2,741** | -82% |

**Phase 1 is expected to operate at a loss.** Free gen costs dominate. This is customer acquisition cost.

### With Phase 2 Adjustment (1/week free) + Phase 3 FAN ($4.99/mo, 3% conversion)

| Scale | Credit Rev | FAN Rev | Total Rev | Total Costs | Profit | Margin |
|-------|-----------|---------|-----------|-------------|--------|--------|
| **5K** | $1,680 | $749 | $2,429 | $2,131 | **+$298** | 12% |
| **10K** | $3,360 | $1,497 | $4,857 | $3,831 | **+$1,026** | 21% |
| **25K** | $8,400 | $3,743 | $12,143 | $7,628 | **+$4,515** | 37% |
| **50K** | $16,800 | $7,485 | $24,285 | $14,256 | **+$10,029** | 41% |

**Break-even: ~4,000 users** with all three layers active.

### With Higher Conversion (7% credit buyers, 5% FAN, 1/week free)

| Scale | Total Rev | Total Costs | Profit | Margin |
|-------|-----------|-------------|--------|--------|
| **10K** | $8,370 | $5,081 | **+$3,289** | 39% |
| **25K** | $20,925 | $10,703 | **+$10,222** | 49% |
| **50K** | $41,850 | $20,406 | **+$21,444** | 51% |

---

## Feature Gating Matrix

| Feature | Free | Credit Buyer | FAN ($4.99/mo) |
|---------|------|-------------|---------------|
| AI Gen (Kling 2.6) | 1/3 days → 1/week | 7 credits | 7 credits |
| AI Gen (other models) | — | 9-15 credits | 9-15 credits |
| Voting | 200/day | 200/day | **Unlimited** |
| Comments | Unlimited | Unlimited | Unlimited |
| Past episodes | All | All | All |
| Leaderboard | Full | Full | Full |
| Badge | Basic | Creator (gold) | FAN (purple) |
| Credits included/mo | 0 | 0 | 5-10 |

**No comment/leaderboard/episode gating** — these cost nothing to serve and keep free users engaged. Gate only what costs money (generations) or what drives subscription value (unlimited voting, badges).

---

## Risk Analysis

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Stripe $0.30 fee on $0.99 pack | 33% fee, near-zero margin | Accept as CAC; track repeat purchase rate; remove if most buyers stay at $0.99 |
| fal.ai price increase | Margin compression | `model_pricing` table is admin-editable; adjust credit costs instantly |
| Low conversion (<2%) | Revenue << free gen costs | Activate first-purchase bonus, reduce prices, or cut free tier to 1/week |
| Multi-account free gen abuse | Inflated free gen costs | Existing device fingerprinting + Google auth requirement |
| Credit hoarding | Accounting liability | No expiry (reduces chargebacks); monitor spend-through rate |
| FAN cannibalizes credit purchases | Lower-margin recurring replaces higher-margin one-time | FAN gives 5 credits/mo (< 7 for 1 Kling gen) — teaser, not replacement |

---

## Critical Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `stripe`, `@stripe/stripe-js` |
| `src/app/api/credits/purchase/route.ts` | **NEW** — Stripe Checkout session |
| `src/app/api/credits/webhook/route.ts` | **NEW** — Stripe webhook handler |
| `src/components/CreditBalance.tsx` | **NEW** — Navbar credit display |
| `src/components/CreditPurchaseModal.tsx` | **NEW** — Package purchase UI |
| `src/app/api/ai/generate/route.ts` | Replace daily counter with cooldown RPC |
| `supabase/sql/` | New migration: cooldown RPC + package update |
| `src/app/api/vote/route.ts:45` | Make `DAILY_VOTE_LIMIT` configurable (future FAN) |
| Supabase feature_flags | Enable `credit_system`, add `free_cooldown_hours` |

## Verification

1. `npm run build` — clean after each step
2. Test Stripe checkout flow in test mode (Stripe test keys)
3. Verify credit deduction → generation → refund on cancel cycle
4. Verify cooldown: generate free → try again immediately → should be blocked
5. Verify model gating: free users can only use Kling 2.6
6. Monitor admin dashboard for conversion rate, free gen costs, ARPU
