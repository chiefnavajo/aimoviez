# Credit-Based Monetization System - Implementation Plan

**Created:** 2026-02-08
**Last Updated:** 2026-02-09 01:45 UTC

## Overview

Implement a credit-based payment system where **every AI video generation costs credits**. No free tier. Users purchase credit packages, and admins control pricing/margins.

## Key Requirements

1. **No free generations** - every video costs credits
2. **Credit packages**: 10, 20, 50, and custom amounts
3. **Credits consumed per generation** until depleted
4. **Admin-configurable margins** per AI model
5. **Stripe integration** for payments

---

## Current State

| Component | Status | Location |
|-----------|--------|----------|
| AI generation via fal.ai | ✅ Implemented | `/api/ai/generate` |
| Cost tracking (internal) | ✅ Exists | `ai_generations.cost_cents` |
| Daily rate limiting | ✅ Implemented | `ai_generation_limits` table |
| Feature flags system | ✅ Implemented | `/api/admin/feature-flags` |
| **Credit balance** | ✅ Implemented | `users.balance_credits` |
| **Credit packages** | ✅ Implemented | `credit_packages` table |
| **Model pricing** | ✅ Implemented | `model_pricing` table |
| **Credit transactions** | ✅ Implemented | `credit_transactions` table |
| **Balance API** | ✅ Implemented | `/api/credits/balance` |
| **Packages API** | ✅ Implemented | `/api/credits/packages` |
| **Generation integration** | ✅ Implemented | Credit check + deduction in generate |
| **Auto-refund** | ✅ Implemented | Webhook + cron refund on failure |
| **Stripe integration** | ❌ Pending | Phase 3 |
| **UI components** | ❌ Pending | Phase 4 |
| **Admin panel** | ❌ Pending | Phase 5 |

---

## Database Schema (New Tables)

### 1. `credit_packages` - Admin-configurable pricing
```sql
CREATE TABLE credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,           -- 'starter', 'popular', 'pro'
  credits INTEGER NOT NULL,            -- 10, 20, 50
  price_cents INTEGER NOT NULL,        -- 199, 399, 899
  bonus_percent INTEGER DEFAULT 0,     -- 0, 10, 20 (bonus %)
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data
INSERT INTO credit_packages (name, credits, price_cents, bonus_percent, sort_order) VALUES
  ('Starter', 10, 199, 0, 1),
  ('Popular', 20, 349, 10, 2),
  ('Pro', 50, 799, 20, 3),
  ('Studio', 100, 1499, 25, 4);
```

### 2. `model_pricing` - Admin margins per model
```sql
CREATE TABLE model_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key VARCHAR(50) UNIQUE NOT NULL,  -- 'kling-2.6', 'veo3-fast'
  fal_cost_cents INTEGER NOT NULL,        -- 35, 80 (what fal.ai charges)
  credit_cost INTEGER NOT NULL,           -- 7, 15 (what user pays in credits)
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data
INSERT INTO model_pricing (model_key, fal_cost_cents, credit_cost) VALUES
  ('kling-2.6', 35, 7),
  ('hailuo-2.3', 49, 9),
  ('veo3-fast', 80, 15),
  ('sora-2', 80, 15),
  ('kling-o1-ref', 56, 11);
```

### 3. Add columns to `users` table
```sql
ALTER TABLE users ADD COLUMN balance_credits INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN lifetime_purchased_credits INTEGER DEFAULT 0;
```

### 4. `credit_transactions` - Audit trail
```sql
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type VARCHAR(30) NOT NULL,              -- 'purchase', 'generation', 'refund', 'admin_grant'
  amount INTEGER NOT NULL,                -- positive=credit, negative=debit
  balance_after INTEGER NOT NULL,
  reference_id UUID,                      -- generation_id or stripe_payment_id
  stripe_payment_intent_id VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_credit_transactions_user ON credit_transactions(user_id);
CREATE INDEX idx_credit_transactions_type ON credit_transactions(type);
```

### 5. RLS Policies
```sql
-- Users can only read their own balance
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- (existing policies)

-- Users can only read their own transactions
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own transactions" ON credit_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- credit_packages and model_pricing are public read
ALTER TABLE credit_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read packages" ON credit_packages
  FOR SELECT USING (is_active = true);

ALTER TABLE model_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read pricing" ON model_pricing
  FOR SELECT USING (is_active = true);
```

---

## API Endpoints (New)

### Payment Routes
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/credits/packages` | GET | List available credit packages |
| `/api/credits/balance` | GET | Get user's current balance |
| `/api/credits/purchase` | POST | Create Stripe checkout session |
| `/api/credits/webhook` | POST | Handle Stripe payment events |

### Admin Routes
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/credits/packages` | GET/POST/PUT/DELETE | Manage credit packages |
| `/api/admin/credits/pricing` | GET/PUT | Manage model pricing/margins |
| `/api/admin/credits/transactions` | GET | View transaction history |
| `/api/admin/credits/grant` | POST | Manually grant credits to user |

---

## Modifications to Existing Code

### `/api/ai/generate` - Add balance check
```typescript
// BEFORE generation starts (after auth, before fal.ai call):

// 1. Get user balance
const { data: user } = await supabase
  .from('users')
  .select('balance_credits')
  .eq('id', userId)
  .single();

// 2. Get model credit cost
const { data: pricing } = await supabase
  .from('model_pricing')
  .select('credit_cost')
  .eq('model_key', effectiveModel)
  .single();

const creditCost = pricing?.credit_cost ?? 10; // fallback

// 3. Check balance
if ((user?.balance_credits ?? 0) < creditCost) {
  return NextResponse.json({
    error: 'Insufficient credits',
    code: 'INSUFFICIENT_CREDITS',
    required: creditCost,
    current: user?.balance_credits ?? 0
  }, { status: 402 }); // Payment Required
}

// 4. Deduct credits atomically
const { data: deduction, error: deductError } = await supabase.rpc('deduct_credits', {
  p_user_id: userId,
  p_amount: creditCost,
  p_generation_id: generationId
});

if (deductError || !deduction.success) {
  return NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 });
}

// Continue with fal.ai generation...
```

### RPC Function for Atomic Deduction
```sql
CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_generation_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Lock row for update
  SELECT balance_credits INTO v_current_balance
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_current_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient credits');
  END IF;

  v_new_balance := v_current_balance - p_amount;

  -- Update balance
  UPDATE users SET balance_credits = v_new_balance WHERE id = p_user_id;

  -- Log transaction
  INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id)
  VALUES (p_user_id, 'generation', -p_amount, v_new_balance, p_generation_id);

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
END;
$$ LANGUAGE plpgsql;
```

### `/api/ai/complete` - Handle refunds on failure
```typescript
// If generation FAILS, refund credits
if (status === 'failed' || status === 'expired') {
  await supabase.rpc('refund_credits', {
    p_user_id: userId,
    p_generation_id: generationId
  });
}
```

### RPC Function for Refunds
```sql
CREATE OR REPLACE FUNCTION refund_credits(
  p_user_id UUID,
  p_generation_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_original_amount INTEGER;
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Find original deduction
  SELECT ABS(amount) INTO v_original_amount
  FROM credit_transactions
  WHERE user_id = p_user_id
    AND reference_id = p_generation_id
    AND type = 'generation'
  LIMIT 1;

  IF v_original_amount IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No transaction found');
  END IF;

  -- Check if already refunded
  IF EXISTS (
    SELECT 1 FROM credit_transactions
    WHERE reference_id = p_generation_id AND type = 'refund'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already refunded');
  END IF;

  -- Lock and update
  SELECT balance_credits INTO v_current_balance
  FROM users WHERE id = p_user_id FOR UPDATE;

  v_new_balance := v_current_balance + v_original_amount;

  UPDATE users SET balance_credits = v_new_balance WHERE id = p_user_id;

  INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id)
  VALUES (p_user_id, 'refund', v_original_amount, v_new_balance, p_generation_id);

  RETURN jsonb_build_object('success', true, 'refunded', v_original_amount);
END;
$$ LANGUAGE plpgsql;
```

---

## Stripe Integration

### `/api/credits/purchase/route.ts`
```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: NextRequest) {
  // Auth check
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { package_id } = await req.json();

  // Get package details
  const { data: pkg } = await supabase
    .from('credit_packages')
    .select('*')
    .eq('id', package_id)
    .eq('is_active', true)
    .single();

  if (!pkg) {
    return NextResponse.json({ error: 'Package not found' }, { status: 404 });
  }

  const totalCredits = pkg.credits + Math.floor(pkg.credits * pkg.bonus_percent / 100);

  // Create Stripe Checkout Session
  const checkoutSession = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `${pkg.name} - ${totalCredits} Credits`,
          description: pkg.bonus_percent > 0
            ? `${pkg.credits} credits + ${pkg.bonus_percent}% bonus`
            : `${pkg.credits} credits`,
        },
        unit_amount: pkg.price_cents,
      },
      quantity: 1,
    }],
    metadata: {
      user_id: session.user.id,
      package_id: pkg.id,
      credits_to_add: totalCredits.toString(),
    },
    success_url: `${process.env.NEXTAUTH_URL}/create?payment=success`,
    cancel_url: `${process.env.NEXTAUTH_URL}/create?payment=cancelled`,
  });

  return NextResponse.json({
    url: checkoutSession.url,
    session_id: checkoutSession.id,
  });
}
```

### `/api/credits/webhook/route.ts`
```typescript
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    const userId = session.metadata?.user_id;
    const creditsToAdd = parseInt(session.metadata?.credits_to_add || '0', 10);

    if (userId && creditsToAdd > 0) {
      await supabase.rpc('add_credits', {
        p_user_id: userId,
        p_amount: creditsToAdd,
        p_stripe_payment_intent_id: session.payment_intent,
      });
    }
  }

  return NextResponse.json({ received: true });
}
```

---

## UI Components (New)

### 1. Credit Balance Display (`CreditBalance.tsx`)
```tsx
// Location: Top-right of /create page navbar
// Shows: "47 🪙" with click to open purchase modal
export function CreditBalance() {
  const { data } = useQuery(['credits-balance'], fetchBalance);
  return (
    <button onClick={openPurchaseModal} className="...">
      <Coins className="w-4 h-4" />
      <span>{data?.balance ?? 0}</span>
    </button>
  );
}
```

### 2. Purchase Modal (`CreditPurchaseModal.tsx`)
- Grid of credit packages
- Shows: price, credits, bonus %, value per credit
- Highlight "Popular" package
- "Buy Now" → Redirects to Stripe Checkout

### 3. Cost Preview in AIGeneratePanel
```tsx
// Before Generate button, show:
<div className="text-sm text-gray-400">
  This will cost <span className="text-white font-bold">{creditCost} credits</span>
</div>

// If insufficient balance:
<button disabled className="opacity-50">
  Insufficient Credits
</button>
<button onClick={openPurchaseModal}>
  Buy Credits
</button>
```

### 4. Admin Pricing Page (`/admin/credits`)
- **Packages Tab**: Table with CRUD for packages
- **Model Pricing Tab**: Edit credit costs per model
- **Transactions Tab**: Search/filter transaction log
- **Grant Credits**: Input user email + amount

---

## Implementation Phases

### Phase 1: Database & Core ✅ COMPLETED
- [x] Create migration file: `supabase/sql/2026-02-08_01_migration-credit-system.sql`
- [x] Create RPC functions: `deduct_credits`, `refund_credits`, `add_credits`, `admin_grant_credits`
- [x] Add `balance_credits` and `lifetime_purchased_credits` columns to users
- [x] Add `credit_deducted` and `credit_amount` columns to ai_generations
- [x] Create `/api/credits/balance` endpoint
- [x] Create `/api/credits/packages` endpoint

### Phase 2: Generation Integration ✅ COMPLETED
- [x] Modify `/api/ai/generate` to check balance (when credit_system flag enabled)
- [x] Add credit deduction before fal.ai call
- [x] Modify `/api/ai/webhook` to auto-refund on failure
- [x] Modify `/api/cron/ai-generation-timeout` to refund orphaned generations
- [x] Add retry logic with exponential backoff for fal.ai calls
- [x] Reduce cron interval from 5min to 2min
- [x] Increase narration timeout from 60s to 120s

### Phase 3: Stripe Integration ⏳ PENDING
- [ ] Install `stripe` npm package
- [ ] Create `/api/credits/purchase` endpoint
- [ ] Create `/api/credits/webhook` endpoint
- [ ] Set up Stripe webhook in Stripe Dashboard
- [ ] Test full purchase flow

### Phase 4: UI Components ⏳ PENDING
- [ ] Create `CreditBalance` component
- [ ] Create `CreditPurchaseModal` component
- [ ] Add cost preview to `AIGeneratePanel`
- [ ] Add "insufficient credits" error state
- [ ] Integrate into `/create` page

### Phase 5: Admin Panel ⏳ PENDING
- [ ] Create `/admin/credits` page
- [ ] Package management CRUD
- [ ] Model pricing editor
- [ ] Transaction history viewer
- [ ] Manual credit grant feature

---

## Credit Package Suggestions

| Package | Credits | Price | Bonus | Total | Per Credit | Kling Gens |
|---------|---------|-------|-------|-------|------------|------------|
| Starter | 10 | $1.99 | 0% | 10 | $0.199 | 1 |
| Popular | 20 | $3.49 | 10% | 22 | $0.159 | 3 |
| Pro | 50 | $7.99 | 20% | 60 | $0.133 | 8 |
| Studio | 100 | $14.99 | 25% | 125 | $0.120 | 17 |

---

## Model Pricing Suggestions

| Model | fal.ai Cost | Credits | User Pays | Margin |
|-------|-------------|---------|-----------|--------|
| Kling 2.6 | $0.35 | 7 | $0.70 | 50% |
| Hailuo 2.3 | $0.49 | 9 | $0.90 | 45% |
| Veo3 Fast | $0.80 | 15 | $1.50 | 47% |
| Sora 2 | $0.80 | 15 | $1.50 | 47% |
| Kling O1 Ref | $0.56 | 11 | $1.10 | 49% |

*Based on 1 credit = $0.10*

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `/src/app/api/ai/generate/route.ts` | Add balance check, deduct credits |
| `/src/app/api/ai/complete/route.ts` | Handle refunds on failure |
| `/src/components/AIGeneratePanel.tsx` | Show cost, handle insufficient balance |
| `/src/app/create/page.tsx` | Add balance display, purchase modal |
| `/supabase/sql/` | New migration file for tables |
| `package.json` | Add `stripe` dependency |

---

## Environment Variables (New)

```env
# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

---

## Verification Checklist

1. **Database**: Run migrations, verify tables created
2. **Balance API**: Test `/api/credits/balance` returns correct data
3. **Generation Block**: Test generation fails with 402 when no credits
4. **Deduction**: Generate video, verify credits deducted
5. **Refund**: Fail a generation, verify credits returned
6. **Purchase**: Complete Stripe checkout, verify credits added
7. **Webhook**: Verify Stripe webhook processes correctly
8. **Admin**: Test package/pricing CRUD operations
9. **UI**: Verify balance displays, purchase modal works

---

## Security Considerations

1. **Stripe webhooks**: Verify signature with `stripe.webhooks.constructEvent()`
2. **Atomic transactions**: Use PostgreSQL transactions/RPC for credit operations
3. **RLS policies**: Users can only read their own balance/transactions
4. **Admin auth**: All admin endpoints require `requireAdmin()` check
5. **Rate limiting**: Keep existing rate limits to prevent abuse
6. **Double-spend prevention**: Use `FOR UPDATE` locks in RPC functions

---

## Session Resilience ✅ IMPLEMENTED

**Concern**: What if user pays credits, then session expires during generation?

**Solution**: The system is session-independent:
- Generation records stored in `ai_generations` table with `user_id`
- fal.ai webhook completes generation without user session
- Auto-refund on failure via webhook + cron job

| Scenario | System Behavior | User Impact |
|----------|-----------------|-------------|
| Session expires during generation | Webhook completes it | None - video ready on re-login |
| Session expires + generation fails | Webhook auto-refunds | None - credits restored |
| Webhook fails silently | Cron job refunds within 2 min | Minimal delay |

---

## Reliability Improvements ✅ IMPLEMENTED

| Improvement | Before | After |
|-------------|--------|-------|
| fal.ai retry | 1 attempt | 3 attempts (1s/2s/4s backoff) |
| Cron interval | Every 5 min | Every 2 min |
| Narration timeout | 60s | 120s |

---

## How to Enable

1. Run migration: `supabase/sql/2026-02-08_01_migration-credit-system.sql`
2. Enable feature flag: Set `credit_system` to `true` in feature_flags table
3. (Optional) Grant test credits via SQL:
   ```sql
   SELECT admin_grant_credits('USER_UUID_HERE', 100, 'Test credits');
   ```

**Note**: When `credit_system` is enabled, daily limits are bypassed - users limited by credit balance only.
