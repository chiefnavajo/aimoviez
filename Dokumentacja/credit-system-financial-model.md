# Credit System — Financial Model & Implementation Plan

## Financial Model

### fal.ai Cost Per Generation (actual)
| Model | Cost/gen | Credit Cost | User Pays | Margin |
|-------|----------|-------------|-----------|--------|
| Kling 2.6 | $0.35 | 5 credits | $0.50 | 43% |
| Hailuo 2.3 | $0.49 | 7 credits | $0.70 | 30% |
| Veo3 Fast | $0.80 | 12 credits | $1.20 | 33% |
| Sora 2 | $0.80 | 12 credits | $1.20 | 33% |

**1 credit = $0.10 user cost** (simplifies mental math and pricing display)

### Credit Packages
| Package | Credits | Price | Bonus | Effective $/credit | Avg Margin |
|---------|---------|-------|-------|---------------------|------------|
| Starter | 10 | $0.99 | 0% | $0.099 | ~35% |
| Creator | 22 | $1.99 | 10% | $0.090 | ~38% |
| Pro | 50 | $3.99 | 25% | $0.080 | ~42% |
| Studio | 120 | $7.99 | 50% | $0.067 | ~47% |
| Custom | N | N×$0.10 | 0% | $0.100 | ~35% |

Custom: user enters any amount 5-500 credits, no bulk discount.

### Free Tier
- 1 free generation/day preserved (cheapest model only: Kling)
- Credits required for premium models (Hailuo, Veo3, Sora)
- Free generation does NOT consume credits

---

## Database Schema

### New Tables

```sql
-- 1. Credit balance (one row per user)
CREATE TABLE user_credits (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_purchased INTEGER NOT NULL DEFAULT 0,
  lifetime_spent INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Transaction log (append-only audit trail)
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL, -- positive = credit, negative = debit
  balance_after INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('purchase','generation','refund','admin_grant','bonus')),
  reference_id TEXT, -- stripe session ID, generation ID, etc.
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Package definitions (admin-editable)
CREATE TABLE credit_packages (
  id TEXT PRIMARY KEY, -- 'starter', 'creator', 'pro', 'studio'
  credits INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  stripe_price_id TEXT, -- Stripe Price object ID
  display_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Model credit costs (admin-tunable)
CREATE TABLE model_credit_costs (
  model_key TEXT PRIMARY KEY, -- 'kling-video-v2.6', etc.
  credits_per_generation INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_credit_transactions_user ON credit_transactions(user_id, created_at DESC);
CREATE INDEX idx_credit_transactions_ref ON credit_transactions(reference_id) WHERE reference_id IS NOT NULL;
```

### RPC Functions

```sql
-- Atomic credit deduction (race-safe)
CREATE OR REPLACE FUNCTION deduct_credits_for_generation(
  p_user_id UUID,
  p_credits INTEGER,
  p_generation_id TEXT
) RETURNS TABLE(success BOOLEAN, new_balance INTEGER, error_code TEXT) AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  SELECT balance INTO v_balance
  FROM user_credits WHERE user_id = p_user_id FOR UPDATE;

  IF v_balance IS NULL THEN
    RETURN QUERY SELECT false, 0, 'NO_CREDIT_RECORD'::TEXT;
    RETURN;
  END IF;

  IF v_balance < p_credits THEN
    RETURN QUERY SELECT false, v_balance, 'INSUFFICIENT_CREDITS'::TEXT;
    RETURN;
  END IF;

  UPDATE user_credits
  SET balance = balance - p_credits,
      lifetime_spent = lifetime_spent + p_credits,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO credit_transactions (user_id, amount, balance_after, type, reference_id, description)
  VALUES (p_user_id, -p_credits, v_balance - p_credits, 'generation', p_generation_id,
          'AI video generation');

  RETURN QUERY SELECT true, v_balance - p_credits, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Atomic credit refund (for failed generations)
CREATE OR REPLACE FUNCTION refund_credits_for_generation(
  p_user_id UUID,
  p_credits INTEGER,
  p_generation_id TEXT
) RETURNS void AS $$
BEGIN
  UPDATE user_credits
  SET balance = balance + p_credits,
      lifetime_spent = lifetime_spent - p_credits,
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO credit_transactions (user_id, amount, balance_after, type, reference_id, description)
  VALUES (p_user_id, p_credits,
          (SELECT balance FROM user_credits WHERE user_id = p_user_id),
          'refund', p_generation_id, 'Refund for failed generation');
END;
$$ LANGUAGE plpgsql;

-- Add credits (purchase or admin grant)
CREATE OR REPLACE FUNCTION add_credits(
  p_user_id UUID,
  p_credits INTEGER,
  p_type TEXT,
  p_reference_id TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  INSERT INTO user_credits (user_id, balance, lifetime_purchased)
  VALUES (p_user_id, p_credits, CASE WHEN p_type = 'purchase' THEN p_credits ELSE 0 END)
  ON CONFLICT (user_id) DO UPDATE
  SET balance = user_credits.balance + p_credits,
      lifetime_purchased = user_credits.lifetime_purchased +
        CASE WHEN p_type = 'purchase' THEN p_credits ELSE 0 END,
      updated_at = now()
  RETURNING balance INTO v_new_balance;

  INSERT INTO credit_transactions (user_id, amount, balance_after, type, reference_id, description)
  VALUES (p_user_id, p_credits, v_new_balance, p_type, p_reference_id, p_description);

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql;
```

### RLS Policies
```sql
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- Users read own credits
CREATE POLICY "Users read own credits" ON user_credits
  FOR SELECT USING (auth.uid() = user_id);

-- Users read own transactions
CREATE POLICY "Users read own transactions" ON credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Service role has full access (API routes use service role key)
```

---

## API Routes

### New Routes

#### `GET /api/credits`
Returns user's credit balance and recent transactions.
```typescript
// Response: { balance, lifetime_purchased, lifetime_spent, recent_transactions[] }
```

#### `GET /api/credits/packages`
Returns available credit packages and model costs.
```typescript
// Response: { packages[], model_costs: Record<modelKey, credits> }
```

#### `POST /api/credits/purchase`
Creates Stripe Checkout session for credit purchase.
```typescript
// Body: { package_id: string } OR { custom_credits: number }
// Response: { checkout_url: string, session_id: string }
```

#### `POST /api/credits/webhook`
Stripe webhook handler — adds credits on successful payment.
```typescript
// Handles: checkout.session.completed
// Calls: add_credits RPC
```

#### `POST /api/admin/credits/grant`
Admin grants credits to a user (requires admin auth).
```typescript
// Body: { user_id, credits, reason }
```

### Modified Routes

#### `POST /api/ai/generate` (modify existing)
- Look up `model_credit_costs` for requested model
- If model costs > 0 credits AND user hasn't used free daily generation on cheapest model:
  - Allow free generation (no credit deduction)
- Else:
  - Call `deduct_credits_for_generation` RPC
  - Store `credits_charged` on `ai_generations` row
- On webhook failure/timeout → call `refund_credits_for_generation`

#### `POST /api/ai/webhook` + `POST /api/ai/timeout` (modify existing)
- On generation failure: auto-refund credits if `credits_charged > 0`

---

## Files to Create/Modify

### New Files
1. `supabase/sql/migration-credit-system.sql` — All tables, RPCs, RLS, seed data
2. `src/app/api/credits/route.ts` — GET balance + transactions
3. `src/app/api/credits/packages/route.ts` — GET packages + model costs
4. `src/app/api/credits/purchase/route.ts` — POST create Stripe checkout
5. `src/app/api/credits/webhook/route.ts` — POST Stripe webhook
6. `src/app/api/admin/credits/grant/route.ts` — POST admin grant
7. `src/components/CreditBalance.tsx` — Header credit display component
8. `src/components/CreditPurchaseModal.tsx` — Purchase modal with package cards
9. `src/types/credits.ts` — TypeScript types for credit system

### Modified Files
10. `src/app/api/ai/generate/route.ts` — Credit deduction before generation
11. `src/app/api/ai/webhook/route.ts` — Credit refund on failure
12. `src/app/api/ai/timeout/route.ts` — Credit refund on timeout
13. `src/components/AIGeneratePanel.tsx` — Show model costs, credit balance, purchase CTA
14. `src/lib/ai-video.ts` — Add `creditCost` to model config exports
15. `src/lib/validations.ts` — Add Zod schemas for credit endpoints

### Environment Variables (new)
```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
```

---

## UI Changes

### Header / Navigation
- Credit balance pill: `[coin icon] 42 credits` next to user avatar
- Clicking opens purchase modal

### AI Generate Panel
- Each model card shows credit cost: `5 credits` / `7 credits` / `12 credits`
- Free daily badge on cheapest model: `FREE (1/day)`
- "Insufficient credits" state with "Buy Credits" button when balance too low
- After generation: `"Used 12 credits — 30 remaining"`

### Purchase Modal
- 4 package cards + custom amount input
- Package cards highlight savings: `"Save 10%"`, `"Save 25%"`, `"Best Value - Save 50%"`
- Stripe Checkout redirect (not embedded — simpler, PCI-compliant)
- Success/cancel return URLs back to generate page

---

## Feature Flag Rollout

Add to existing `feature_flags` table:
```sql
INSERT INTO feature_flags (key, enabled, metadata) VALUES
('credit_system', true, '{"free_daily_generations": 1, "enable_purchases": true}');
```

**Phase 1**: `credit_system` enabled, `enable_purchases: false`
- Users see credit costs on models but all generations are free
- Admin can grant test credits

**Phase 2**: `enable_purchases: true`
- Stripe integration live
- Free daily generation still available
- Premium models require credits

**Phase 3**: Adjust free tier based on metrics
- Could remove free daily, reduce to weekly, or keep as-is

---

## Verification

1. **SQL migration**: Run in Supabase SQL editor, verify tables/RPCs created
2. **Credit balance API**: `curl /api/credits` returns `{ balance: 0 }`
3. **Packages API**: `curl /api/credits/packages` returns 4 packages + model costs
4. **Admin grant**: Grant 50 credits via admin route, verify balance updates
5. **Generate with credits**: Select premium model, verify credits deducted
6. **Free daily**: First daily generation on Kling costs 0 credits
7. **Insufficient credits**: Try premium model with 0 balance, verify blocked
8. **Stripe purchase**: Complete test checkout, verify credits added via webhook
9. **Refund on failure**: Trigger timeout, verify credits refunded
10. **`npm run build`**: Verify no type errors

---

## Implementation Order

1. SQL migration (tables, RPCs, seed data, RLS)
2. TypeScript types (`src/types/credits.ts`)
3. Zod validations for credit endpoints
4. `GET /api/credits` + `GET /api/credits/packages`
5. `POST /api/admin/credits/grant`
6. Modify `POST /api/ai/generate` — credit deduction logic
7. Modify webhook + timeout routes — refund logic
8. `CreditBalance.tsx` header component
9. Modify `AIGeneratePanel.tsx` — show costs, balance, insufficient state
10. `POST /api/credits/purchase` — Stripe checkout
11. `POST /api/credits/webhook` — Stripe webhook handler
12. `CreditPurchaseModal.tsx` — purchase UI
13. Feature flag integration
14. `npm run build` verification
