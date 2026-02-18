# aimoviez — Optimized Monetization Model

## Research Sources

Based on deep analysis of:
- **fal.ai**: Dollar-denominated prepaid credits, $0.35-$0.80/video gen, 365-day expiry, $10 signup bonus, 2 concurrent tasks standard / 40 at $1K+ balance
- **Competitors**: Midjourney ($10-$120/mo), Leonardo.ai (free-$48/mo, token system), Runway ML (free-$76/mo, $0.01/credit)
- **Wrappers**: Successful resellers mark up 50-100% on fal.ai costs (Freepik, Krea, Flora)
- **Conversion data**: Freemium-to-paid median 2-5%, impulse ceiling $4.99, "magic number" $9.99
- **Psychology**: Top 10% of payers = 90% of revenue, credits decouple payment from spending, anchoring increases ARPU 25-40%

---

## Three Revenue Layers

```
Layer 1: FREE tier          -> acquisition funnel (all users)
Layer 2: FAN membership     -> recurring revenue from viewers/voters ($4.99/mo)
Layer 3: Credits            -> transactional revenue from creators (40-50% margin)
```

---

## Credit Denomination

**1 credit = $0.10** -- simple mental math, arcade-coin feel, clean display numbers.

Stored internally as `balance_cents` (integer). Frontend divides by 10 to show credits.

---

## Model Pricing (What Creators Pay)

| Model | Our Cost (fal.ai) | Credits | User Pays | Margin |
|-------|-------------------|---------|-----------|--------|
| Kling 2.6 (Standard) | $0.35 | **7 credits** | $0.70 | **50%** |
| Hailuo 2.3 (Standard) | $0.49 | **9 credits** | $0.90 | **46%** |
| Veo3 Fast (Premium) | $0.80 | **15 credits** | $1.50 | **47%** |
| Sora 2 (Premium) | $0.80 | **15 credits** | $1.50 | **47%** |

Users typically need 2-4 attempts per "keeper" video -> effective spend per good clip: $1.40-$6.00.

Comparison: fal.ai charges $0.35-$0.80 direct. We charge $0.70-$1.50 (2x markup). This is within the 50-100% wrapper markup range that the market supports.

---

## Credit Packages

| Package | Price | Credits | Bonus | Total | $/Credit | Kling Gens | UI Label |
|---------|-------|---------|-------|-------|----------|------------|----------|
| **Taste** | $0.99 | 10 | -- | 10 | $0.099 | 1 | -- |
| **Starter** | $4.99 | 50 | +5 (10%) | 55 | $0.091 | 7 | Save 10% |
| **Popular** | $9.99 | 100 | +15 (15%) | 115 | $0.087 | 16 | MOST POPULAR |
| **Studio** | $24.99 | 250 | +50 (20%) | 300 | $0.083 | 42 | Save 20% |
| **Unlimited** | $49.99 | 500 | +150 (30%) | 650 | $0.077 | 92 | Best Value |

**Anchoring**: Display $49.99 pack first (leftmost). $9.99 "Popular" marked with badge.

**First-purchase bonus**: 50% extra credits on first buy (tracked via lifetime_purchased).

### Creator Subscription (auto-refill)

| Plan | Price | Credits/mo | Bonus | Total/mo | vs One-Time |
|------|-------|-----------|-------|----------|-------------|
| Creator Monthly | $14.99/mo | 150 | +25 | 175 | 12% savings |
| Creator Annual | $119.99/yr | 175/mo | +35 | 210/mo | 29% savings |

Subscription credits roll over 1 month only. One-time credits never expire.

---

## FAN Membership (Viewer Tier)

| | FAN Monthly | FAN Annual |
|---|---|---|
| **Price** | **$4.99/mo** | **$39.99/yr** ($3.33/mo) |
| Votes/day | Unlimited | Unlimited |
| Past episodes | All | All |
| Comments/day | Unlimited | Unlimited |
| Leaderboard | Full | Full |
| Profile badge | Purple FAN badge | Purple FAN badge |
| Username flair | Purple glow | Purple glow |
| Early slot access | 1 hour early | 1 hour early |
| Season theme voting | Yes | Yes |
| Credits included/mo | 5 | 10 |

$4.99 = impulse purchase ceiling. Annual at 33% discount locks in LTV.
The 5-10 included credits/month bridge viewers into trying creation -> cross-sell.

---

## Free Tier (Acquisition Layer)

| Feature | Free Limit | Upgrade Trigger |
|---------|-----------|----------------|
| AI Generation | **1/week** (Kling 2.6 only) | "Buy credits for more generations" |
| Voting | **50 votes/day** | "Upgrade to FAN for unlimited voting" |
| Past episodes | **3 episodes** | "Subscribe to watch all episodes" |
| Comments | **5/day** | "FAN members get unlimited comments" |
| Leaderboard | **Top 10 only** | "Full leaderboard for FAN members" |
| Model selection | Kling 2.6 only | "Premium models require credits" |

**Key changes from current state**: Free gen drops from 1/day -> 1/week. Voting drops from 200/day -> 50/day. Premium models gated behind credits. This prevents free tier from being "enough" (research: 50% of non-payers say free meets their needs).

---

## Feature Gating Matrix

| Feature | Free | FAN ($4.99/mo) | Credits Only | FAN + Credits |
|---------|------|---------------|-------------|--------------|
| **Votes/day** | 50 | Unlimited | 50 | Unlimited |
| **Free gen** | 1/week (Kling) | 1/week (Kling) | 1/week (Kling) | 1/week (Kling) |
| **Paid gen (Kling)** | -- | -- | 7 credits | 7 credits |
| **Paid gen (Hailuo)** | -- | -- | 9 credits | 9 credits |
| **Paid gen (Veo3/Sora)** | -- | -- | 15 credits | 15 credits |
| **Past episodes** | 3 | All | 3 | All |
| **Comments/day** | 5 | Unlimited | 5 | Unlimited |
| **Leaderboard** | Top 10 | Full | Full | Full |
| **Badge** | Basic | FAN (purple) | Creator (gold) | FAN + Creator |
| **Flair** | None | Purple glow | Gold glow | Purple + Gold |
| **Early slot access** | No | 1h early | No | 1h early |
| **Season theme vote** | No | Yes | No | Yes |
| **Priority clip review** | No | No | Yes (>100 credits purchased) | Yes |
| **Credits included/mo** | 0 | 5 | 0 | 5 |

---

## Revenue Projections (Base: 10,000 Users)

### Assumptions
- 10,000 registered users (total user base)
- DAU ratio: ~33% (3,300 daily active users)
- FAN conversion: 5% of registered = 500 FAN subscribers
- Credit buyer conversion: 4% of registered = 400 credit buyers
- Creator subscription: 10% of credit buyers = 40 creator subscribers
- FAN split: 80% monthly / 20% annual
- Average credit spend per buyer: $10/mo
- Average paid generations per credit buyer: ~12/mo

### Revenue Breakdown

| Revenue Stream | Users | Price | Monthly Revenue |
|---|---|---|---|
| FAN Monthly (80%) | 400 x $4.99 | $4.99/mo | **$1,996** |
| FAN Annual (20%) | 100 x $3.33 | $39.99/yr | **$333** |
| Credit pack purchases | 400 x $10/mo avg | varies | **$4,000** |
| Creator Monthly subs | 32 x $14.99 | $14.99/mo | **$480** |
| Creator Annual subs | 8 x $10.00/mo | $119.99/yr | **$80** |
| **Total Revenue** | | | **$6,889/mo** |
| | | | **$82,668/yr** |

### Cost Breakdown

| Cost Center | Calculation | Monthly Cost |
|---|---|---|
| Vercel Pro | Hosting + cron + edge | **$20** |
| Supabase Pro | ~2M queries/day | **$25** |
| Upstash Redis | ~18M cmds/mo | **$3.60** |
| Cloudflare | R2 (45GB) + Worker | **$2** |
| fal.ai (free gens) | ~2,838 free gens/mo x $0.35 (capped $1,500/mo) | **$993** |
| fal.ai (paid gens) | 440 buyers x 12 gens/mo x $0.47 avg | **$2,482** |
| Stripe fees | 2.9% + $0.30 on ~400 transactions | **$320** |
| **Total Costs** | | **$3,846/mo** |
| | | **$46,152/yr** |

### Profit & Loss

| Metric | Monthly | Annual |
|---|---|---|
| **Total Revenue** | $6,889 | $82,668 |
| **Total Costs** | $3,846 | $46,152 |
| **Net Profit** | **$3,043** | **$36,516** |
| **Profit Margin** | **44.2%** | **44.2%** |

### Revenue Mix

| Stream | Monthly | % of Total |
|---|---|---|
| FAN memberships | $2,329 | 33.8% |
| Credit purchases | $4,000 | 58.1% |
| Creator subscriptions | $560 | 8.1% |

### Key Metrics

| Metric | Value |
|---|---|
| Revenue per registered user | $0.69/mo |
| Revenue per DAU | $2.09/mo |
| ARPU (paying users only) | $7.33/mo |
| Margin per paid generation | $0.36 (43%) |
| LTV of FAN subscriber (12-mo) | $47.88 |
| LTV of Creator subscriber (12-mo) | $143.88 |

### Sensitivity Analysis

| Scenario | Revenue | Costs | Profit | Margin |
|---|---|---|---|---|
| **Base case** | $6,889 | $3,846 | $3,043 | 44.2% |
| **Conservative** (3% conversion) | $5,167 | $3,150 | $2,017 | 39.0% |
| **Optimistic** (7% conversion) | $9,645 | $4,844 | $4,801 | 49.8% |
| **No free gen** | $6,889 | $2,353 | $4,536 | 65.8% |
| **Double credit spend** | $10,889 | $5,878 | $5,011 | 46.0% |

### Scaling Projections

| Users | Revenue/mo | Costs/mo | Profit/mo | Margin |
|---|---|---|---|---|
| 5,000 | $3,445 | $2,173 | $1,272 | 36.9% |
| **10,000** | **$6,889** | **$3,846** | **$3,043** | **44.2%** |
| 25,000 | $17,223 | $8,865 | $8,358 | 48.5% |
| 50,000 | $34,445 | $16,730 | $17,715 | 51.4% |
| 100,000 | $68,890 | $32,460 | $36,430 | 52.9% |

### Break-Even: ~4,200 users (with free gen) or ~1,800 users (without)

---

## Cross-Sell Mechanics

**Viewer -> Creator**:
- FAN includes 5 credits/mo (try creating for free)
- "Create like this" button on every clip in voting feed
- Winner celebration: "Want to create the next winner?"

**Creator -> Viewer**:
- Creators naturally vote (they want their clips to win)
- After credit purchase, upsell: "Add FAN for $4.99/mo, get 5 free credits + unlimited voting"

**Whale Capture** (top 10% = 90% of revenue):
- Creator subscription ($14.99-$119.99/yr)
- Large credit packs ($24.99, $49.99)
- "Studio" badge for $50+ lifetime spend, gold username flair
- Priority clip review queue
- Future: Season sponsorship ($99, name on story slot)

---

## Urgency Mechanics

1. **First-purchase bonus**: 50% extra credits on first buy
2. **Flash sales**: Feature-flagged "24h: 30% bonus credits" banner
3. **Low balance nudge**: Persistent banner when < 10 credits
4. **Subscription trial**: 7-day free FAN trial (Stripe-native)
5. **Season finale specials**: Double credits during season transitions

---

## Comparison with fal.ai's Model

| Aspect | fal.ai | aimoviez |
|--------|--------|----------|
| Credit unit | $1.00 (dollar-denominated) | $0.10 (1 credit) |
| Free tier | $10 signup bonus | 1 free gen/week |
| Subscription | None (pure usage) | FAN ($4.99) + Creator ($14.99) |
| Expiry | 365 days purchased, 90 days free | Never (one-time), 60 days (subscription) |
| Markup | N/A (they're the provider) | 46-50% over fal.ai cost |
| Volume discount | Contact sales | 10-30% bonus credits on larger packs |
| Concurrency | 2 tasks (40 at $1K+) | N/A (queue-based) |

Key differences: fal.ai is B2B API-first with no subscription. We're B2C entertainment-first with subscription + credits hybrid, which research shows generates 43% more revenue than pure usage-based models.
