# AiMoviez Credit System — Financial Analysis

## Instructions for Claude
Analyze this financial model for an AI video generation platform. Calculate profitability, IRR (Internal Rate of Return), and ROI under multiple scenarios. Identify risks and suggest optimizations.

---

## 1. Credit System Overview

**1 credit = $0.10 face value**

Users purchase credit packs to generate AI videos. The platform pays fal.ai per generation and keeps the margin.

---

## 2. Credit Packages

| Package | Price | Base Credits | Bonus Credits | Total Credits | Effective $/Credit | Discount |
|---------|-------|-------------|---------------|---------------|-------------------|----------|
| Starter | $9.99 | 100 | 0 | 100 | $0.100 | 0% |
| Plus | $19.99 | 200 | 20 | 220 | $0.091 | 9% |
| Pro | $49.99 | 500 | 75 | 575 | $0.087 | 13% |
| Custom | $X | X÷0.10 | 0 | X÷0.10 | $0.100 | 0% |

Custom: user enters any dollar amount ($1.00 minimum, $500 max). No bonus. 1 credit per $0.10.

---

## 3. Platform Costs Per Generation

### 3a. AI Video Generation (fal.ai)

| Model | Platform Cost | Credits Charged | User Pays | Gross Margin |
|-------|-------------|-----------------|-----------|-------------|
| Kling 2.6 | $0.35 | 7 | $0.70 | $0.35 (50.0%) |
| Hailuo 2.3 | $0.49 | 10 | $1.00 | $0.51 (51.0%) |
| Veo3 Fast | $0.80 | 15 | $1.50 | $0.70 (46.7%) |
| Sora 2 | $0.80 | 15 | $1.50 | $0.70 (46.7%) |

### 3b. AI Narration (ElevenLabs TTS, optional add-on)

| Service | Platform Cost | Credits Charged | User Pays | Gross Margin |
|---------|-------------|-----------------|-----------|-------------|
| Narration | $0.05 | 1 | $0.10 | $0.05 (50.0%) |

### 3c. Free Tier Cost (platform absorbs)

| Feature | Details | Platform Cost |
|---------|---------|--------------|
| Free daily generation | 1/day, Kling 2.6 only | $0.35/user/day |
| Free narration on free gen | Included with free gen | $0.05/user/day |
| Total free tier cost per active free user | | $0.40/day max |

---

## 4. Stripe Payment Processing Fees

Stripe charges: **2.9% + $0.30** per successful transaction.

| Package | Price | Stripe Fee | Net Revenue | Fee % |
|---------|-------|-----------|-------------|-------|
| Starter | $9.99 | $0.59 | $9.40 | 5.9% |
| Plus | $19.99 | $0.88 | $19.11 | 4.4% |
| Pro | $49.99 | $1.75 | $48.24 | 3.5% |
| Custom $5 | $5.00 | $0.45 | $4.55 | 9.0% |
| Custom $100 | $100.00 | $3.20 | $96.80 | 3.2% |

---

## 5. Profit Per Package (After Stripe, Before Generation Costs)

| Package | Price | Stripe Fee | Net Revenue | Total Credits | Credit Face Value | Unrealized Margin |
|---------|-------|-----------|-------------|---------------|-------------------|-------------------|
| Starter | $9.99 | $0.59 | $9.40 | 100 | $10.00 | $9.40 |
| Plus | $19.99 | $0.88 | $19.11 | 220 | $22.00 | $19.11 |
| Pro | $49.99 | $1.75 | $48.24 | 575 | $57.50 | $48.24 |

Note: "Unrealized Margin" = net revenue held until credits are spent on generations. Actual profit depends on model mix.

---

## 6. Profit Per Package When Credits Are Fully Spent

### Assumed Model Usage Mix

| Model | % of Generations | Credits/Gen | Platform Cost/Gen |
|-------|-----------------|-------------|-------------------|
| Kling 2.6 | 40% | 7 | $0.35 |
| Hailuo 2.3 | 25% | 10 | $0.49 |
| Veo3 Fast | 20% | 15 | $0.80 |
| Sora 2 | 15% | 15 | $0.80 |

**Weighted averages:**
- Avg credits per generation: (0.40×7) + (0.25×10) + (0.20×15) + (0.15×15) = **10.55 credits**
- Avg platform cost per generation: (0.40×$0.35) + (0.25×$0.49) + (0.20×$0.80) + (0.15×$0.80) = **$0.5425**
- Avg revenue per generation (at face value): 10.55 × $0.10 = **$1.055**
- **Avg gross margin per generation: $0.5125 (48.6%)**

### Fully-Spent Package Economics

| Package | Net Rev (post-Stripe) | Total Credits | Est. Generations | Total fal.ai Cost | **Net Profit** | **Profit Margin** |
|---------|----------------------|---------------|-----------------|-------------------|----------------|-------------------|
| Starter ($9.99) | $9.40 | 100 | 9.5 | $5.15 | **$4.25** | **42.5%** |
| Plus ($19.99) | $19.11 | 220 | 20.9 | $11.34 | **$7.77** | **38.9%** |
| Pro ($49.99) | $48.24 | 575 | 54.5 | $29.57 | **$18.67** | **37.3%** |

Note: Plus and Pro have lower margins because bonus credits cost the platform but generate no revenue. This is intentional — volume incentive.

---

## 7. Revenue Projections

### Assumptions

| Parameter | Value | Notes |
|-----------|-------|-------|
| Registered users | Variable (see scenarios) | |
| DAU ratio | 33% | Typical for entertainment apps |
| Free tier users (% of DAU) | 80% | Most users don't pay |
| Paying conversion rate | 5% of registered | Industry median for freemium |
| Avg purchases per buyer/month | 1.5 | Mix of one-time and repeat |
| Package distribution | 30% Starter, 40% Plus, 25% Pro, 5% Custom ($15 avg) | Plus is default anchor |
| Average transaction value | Weighted: $24.24 | Based on distribution above |
| Free gen utilization | 30% of free DAU | Not all free users generate daily |
| Narration add-on rate | 20% of paid generations | |
| Credit breakage (unused) | 8% | Credits purchased but never spent |

### Monthly Infrastructure Costs (Full Breakdown From Codebase Audit)

Infrastructure costs scale with users due to Redis commands, Supabase realtime connections, and serverless invocations.

#### Fixed Costs (Regardless of Users)

| Service | Cost/mo | What It Does |
|---------|---------|-------------|
| Vercel Pro | $20 | Hosting, serverless functions, 8 cron jobs (225K+ invocations/mo from crons alone) |
| Domain (`aimoviez.app`) | $1.50 | `.app` TLD registration (~$18/year) |
| Stripe | $0 | No monthly fee (per-transaction only) |
| **Total Fixed** | **$21.50** | |

#### Scaling Costs (Grow With Users)

| Service | 1K Users | 5K Users | 10K Users | What Drives Cost |
|---------|----------|----------|-----------|-----------------|
| Supabase Pro | $25 | $25 | $50 | 21 tables, 40+ RPCs, 7 realtime channels, concurrent WebSocket connections |
| Upstash Redis | $10 | $35 | $75 | 9 modules (rate limiting, vote queues, leaderboards, session cache, seen tracking, CRDT counters, vote cache, comment queue, vote validation) — commands scale linearly with every user action |
| Cloudflare R2 | $2 | $8 | $15 | Video storage ($0.015/GB/mo), Class A/B operations. Free egress via CDN |
| Cloudflare Worker | $0 | $5 | $8 | Edge rate limiting on all `/api/*` routes. Free tier: 100K req/day |
| Sentry | $0 | $0-26 | $26 | Error monitoring + 10% session replay. Free tier: 5K errors + 50 replays/mo |
| Vercel overages | $0 | $0-10 | $10-20 | Serverless invocations beyond Pro tier (crons + API traffic) |
| **Total Scaling** | **$37** | **$83-$109** | **$184-$194** | |

#### Total Infrastructure by Scale

| Scale | Fixed | Scaling | **Total Infra** |
|-------|-------|---------|-----------------|
| 1,000 users | $21.50 | $37 | **$59** |
| 5,000 users | $21.50 | $96 | **$118** |
| 10,000 users | $21.50 | $189 | **$211** |

#### Cost Dominance at 10K Users (fal.ai vs everything else)

| Category | Monthly Cost | % of Total |
|----------|-------------|-----------|
| fal.ai free generations | $10,395 | 70.1% |
| fal.ai paid generations | $4,069 | 27.4% |
| Infrastructure (all services above) | $211 | 1.4% |
| ElevenLabs narration | $75 | 0.5% |
| Stripe processing fees | $750 | N/A (deducted from revenue) |

**Key insight: fal.ai is 97.5% of non-Stripe costs. Infrastructure is a rounding error. The single biggest lever for profitability is the free generation tier.**

### Scenario Projections

#### Scenario A: 1,000 Users (Early Stage)

| Metric | Calculation | Value |
|--------|------------|-------|
| DAU | 1,000 × 33% | 330 |
| Paying users | 1,000 × 5% | 50 |
| Monthly transactions | 50 × 1.5 | 75 |
| **Gross revenue** | 75 × $24.24 avg | **$1,818** |
| | **COSTS** | |
| Stripe fees | 75 × $1.00 avg | ($75) |
| fal.ai (paid gens) | 50 users × ~15 gens/mo × $0.5425 | ($407) |
| fal.ai (free gens) | 330 × 30% × 30 days × $0.35 | ($1,040) |
| ElevenLabs narration | 15 gens × 20% × $0.05 × 50 users | ($8) |
| Vercel Pro | Hosting + 8 cron jobs | ($20) |
| Supabase Pro | DB + realtime + storage | ($25) |
| Upstash Redis | 9 modules, 330 DAU | ($10) |
| Cloudflare R2 + Worker | Video storage + edge rate limit | ($2) |
| Sentry | Free tier | ($0) |
| Domain | aimoviez.app | ($1.50) |
| Credit breakage recovery | $1,818 × 8% × 48.6% margin | +$71 |
| | **TOTALS** | |
| Total costs | | ($1,518) |
| **Monthly profit** | | **$300** |
| **Profit margin** | | **16.5%** |

#### Scenario B: 5,000 Users (Growth)

| Metric | Calculation | Value |
|--------|------------|-------|
| DAU | 5,000 × 33% | 1,650 |
| Paying users | 5,000 × 5% | 250 |
| Monthly transactions | 250 × 1.5 | 375 |
| **Gross revenue** | 375 × $24.24 | **$9,090** |
| | **COSTS** | |
| Stripe fees | 375 × $1.00 avg | ($375) |
| fal.ai (paid gens) | 250 × 15 × $0.5425 | ($2,034) |
| fal.ai (free gens) | 1,650 × 30% × 30 × $0.35 | ($5,198) |
| ElevenLabs narration | | ($38) |
| Vercel Pro + overages | Hosting + crons + 5K DAU traffic | ($25) |
| Supabase Pro | DB + realtime (1,650 concurrent WS) | ($25) |
| Upstash Redis | 9 modules, 1,650 DAU | ($35) |
| Cloudflare R2 + Worker | Growing storage + edge | ($13) |
| Sentry | May exceed free tier | ($13) |
| Domain | | ($1.50) |
| Credit breakage recovery | | +$354 |
| | **TOTALS** | |
| Total costs | | ($7,403) |
| **Monthly profit** | | **$1,687** |
| **Profit margin** | | **18.6%** |

#### Scenario C: 10,000 Users (Established)

| Metric | Calculation | Value |
|--------|------------|-------|
| DAU | 10,000 × 33% | 3,300 |
| Paying users | 10,000 × 5% | 500 |
| Monthly transactions | 500 × 1.5 | 750 |
| **Gross revenue** | 750 × $24.24 | **$18,180** |
| | **COSTS** | |
| Stripe fees | 750 × $1.00 avg | ($750) |
| fal.ai (paid gens) | 500 × 15 × $0.5425 | ($4,069) |
| fal.ai (free gens) | 3,300 × 30% × 30 × $0.35 | ($10,395) |
| ElevenLabs narration | | ($75) |
| Vercel Pro + overages | Hosting + crons + 10K user traffic | ($35) |
| Supabase Pro | DB + realtime (3,300 concurrent WS) | ($50) |
| Upstash Redis | 9 modules, 3,300 DAU, millions of cmds | ($75) |
| Cloudflare R2 + Worker | ~50GB storage + edge | ($23) |
| Sentry | Exceeds free tier | ($26) |
| Domain | | ($1.50) |
| Credit breakage recovery | | +$707 |
| | **TOTALS** | |
| Total costs | | ($14,792) |
| **Monthly profit** | | **$3,388** |
| **Profit margin** | | **18.6%** |

#### Scenario D: 10,000 Users + Reduced Free Tier (1/week instead of 1/day)

| Metric | Calculation | Value |
|--------|------------|-------|
| Gross revenue | Same as Scenario C | $18,180 |
| | **COSTS** | |
| Stripe fees | | ($750) |
| fal.ai (paid gens) | Same | ($4,069) |
| fal.ai (free gens) | 3,300 × 30% × 4.3/mo × $0.35 | **($1,490)** |
| ElevenLabs narration | | ($75) |
| All infrastructure | Vercel + Supabase + Redis + R2 + Sentry + Domain | ($211) |
| Credit breakage recovery | | +$707 |
| | **TOTALS** | |
| Total costs | | ($5,888) |
| **Monthly profit** | | **$12,292** |
| **Profit margin** | | **67.6%** |

#### Scenario E: 10,000 Users + 1/week + No Sora 2 (60% Kling mix)

| Metric | Calculation | Value |
|--------|------------|-------|
| Gross revenue | Same | $18,180 |
| fal.ai (paid gens) | Lower avg cost ($0.44/gen vs $0.54) | ($3,300) |
| fal.ai (free gens) | 1/week | ($1,490) |
| All other costs | Same as D | ($1,036) |
| Credit breakage recovery | | +$707 |
| **Monthly profit** | | **$13,061** |
| **Profit margin** | | **71.8%** |

---

## 8. Sensitivity Analysis

| Variable Changed | Base (10K users) | Impact on Monthly Profit |
|-----------------|-------------------|-------------------------|
| Conversion 3% → 5% → 7% | $3,547 | $1,768 / $3,547 / $5,326 |
| Free tier 1/day → 1/3 days → 1/week | $3,547 | $3,547 / $6,580 / $12,452 |
| Avg transaction $24 → $30 → $40 | $3,547 | $3,547 / $5,171 / $7,907 |
| Model mix shifts to 60% Kling | $3,547 | $4,211 (cheaper gens = more margin) |
| Model mix shifts to 60% Veo3 | $3,547 | $2,102 (expensive gens = less margin) |
| Paying conversion 5% + reduce free to 1/week | Combined | **$14,231** (highest scenario) |

**Key finding**: Free tier cost is the single largest expense. Moving from 1/day to 1/week increases profit by $8,905/mo at 10K users.

---

## 9. IRR Analysis (Internal Rate of Return)

### Initial Investment (Month 0)

| Item | Cost | Notes |
|------|------|-------|
| Development (credit system) | $0 | Built in-house |
| Stripe account setup | $0 | Free |
| Stripe product/price creation | $0 | Free |
| Legal (ToS update for payments) | $500 | One-time legal review |
| Initial fal.ai deposit | $100 | Pre-fund account |
| Marketing launch budget | $500 | Social media + initial ads |
| **Total initial investment** | **$1,100** | |

### Monthly Cash Flows (12-Month Projection)

Growth assumption: Start at 500 users, grow 30% month-over-month for 6 months, then 15% for next 6 months.

Cost model per month: Stripe fees + fal.ai (free + paid) + ElevenLabs + infrastructure (Vercel $20 + Supabase $25 + Redis scaling + R2 + CF Worker + Sentry + domain $1.50).

| Month | Users | DAU | Paying | Revenue | fal.ai Free | fal.ai Paid | Stripe | Infra | Narration | **Net Cash Flow** |
|-------|-------|-----|--------|---------|-------------|-------------|--------|-------|-----------|-------------------|
| 0 | -- | -- | -- | -- | -- | -- | -- | -- | -- | **-$1,100** |
| 1 | 500 | 165 | 25 | $909 | ($519) | ($204) | ($37) | ($49) | ($4) | **$96** |
| 2 | 650 | 215 | 33 | $1,199 | ($675) | ($269) | ($49) | ($51) | ($5) | **$150** |
| 3 | 845 | 279 | 42 | $1,527 | ($878) | ($342) | ($63) | ($54) | ($7) | **$183** |
| 4 | 1,099 | 363 | 55 | $2,000 | ($1,142) | ($448) | ($82) | ($59) | ($9) | **$260** |
| 5 | 1,428 | 471 | 71 | $2,582 | ($1,483) | ($579) | ($106) | ($65) | ($11) | **$338** |
| 6 | 1,857 | 613 | 93 | $3,382 | ($1,929) | ($758) | ($139) | ($73) | ($15) | **$468** |
| 7 | 2,135 | 705 | 107 | $3,891 | ($2,219) | ($872) | ($160) | ($80) | ($17) | **$543** |
| 8 | 2,456 | 810 | 123 | $4,476 | ($2,552) | ($1,003) | ($184) | ($88) | ($20) | **$629** |
| 9 | 2,824 | 932 | 141 | $5,129 | ($2,933) | ($1,151) | ($211) | ($97) | ($22) | **$715** |
| 10 | 3,248 | 1,072 | 162 | $5,892 | ($3,374) | ($1,322) | ($243) | ($107) | ($26) | **$820** |
| 11 | 3,735 | 1,233 | 187 | $6,802 | ($3,881) | ($1,525) | ($280) | ($118) | ($30) | **$968** |
| 12 | 4,296 | 1,418 | 215 | $7,822 | ($4,464) | ($1,753) | ($322) | ($131) | ($34) | **$1,118** |

**12-month totals:**
- Total Revenue: $45,611
- Total fal.ai (free): ($26,049) — **57.1% of revenue consumed by free tier**
- Total fal.ai (paid): ($10,226)
- Total Stripe fees: ($1,876)
- Total infrastructure: ($972)
- Total narration: ($200)
- **Total Costs: ($39,323)**
- **Total Net Profit: $6,288**
- Initial Investment: $1,100

**IRR Calculation Inputs:**
- Cash flow array: [-1100, 96, 150, 183, 260, 338, 468, 543, 629, 715, 820, 968, 1118]
- Use Excel `=IRR(array)` or Python `numpy.irr(array)`
- **Estimated Monthly IRR: ~15-20%**
- **Estimated Annualized IRR: ~400-700%**

Note: IRR is lower than a naive model would suggest because free generation costs scale with users and consume the majority of revenue. This is the fundamental tension: free tier drives growth but eats margins.

**Comparison: Same 12 months with free tier at 1/week:**
- Total fal.ai (free) drops from $26,049 to **$3,721**
- Total Net Profit jumps to **$28,616**
- Cash flow array: [-1100, 463, 627, 775, 1,068, 1,386, 1,826, 2,114, 2,450, 2,828, 3,257, 3,761, 4,324]
- **Estimated Monthly IRR: ~55-65%**
- This shows why free tier frequency is the single most important business decision.

---

## 10. ROI Analysis (Return on Investment)

### 12-Month ROI (Free tier 1/day)

| Metric | Value |
|--------|-------|
| Total Investment | $1,100 |
| Total Net Profit (12 months) | $6,288 |
| **ROI** | **(6,288 - 1,100) / 1,100 × 100 = 471%** |
| Payback period | Month 5 (cumulative profit exceeds $1,100) |

### 12-Month ROI (Free tier 1/week)

| Metric | Value |
|--------|-------|
| Total Investment | $1,100 |
| Total Net Profit (12 months) | $28,616 |
| **ROI** | **(28,616 - 1,100) / 1,100 × 100 = 2,501%** |
| Payback period | Month 2 |

### ROI by Scenario (12 months, free tier 1/day)

| Scenario | Users at M12 | 12-mo Revenue | 12-mo Profit | ROI |
|----------|-------------|---------------|-------------|-----|
| Slow growth (15%/mo) | 2,056 | $20,339 | $2,287 | 108% |
| Base growth (30%→15%) | 4,296 | $45,611 | $6,288 | 471% |
| Fast growth (40%→20%) | 8,916 | $89,459 | $8,631 | 685% |
| Flat (1,000 users, no growth) | 1,000 | $21,816 | $3,696 | 236% |

Note: Fast growth has lower-than-expected ROI because more users = more free generation costs. Growth is actually expensive when free tier is 1/day.

### ROI by Scenario (12 months, free tier 1/week)

| Scenario | Users at M12 | 12-mo Revenue | 12-mo Profit | ROI |
|----------|-------------|---------------|-------------|-----|
| Slow growth (15%/mo) | 2,056 | $20,339 | $11,500 | 945% |
| Base growth (30%→15%) | 4,296 | $45,611 | $28,616 | 2,501% |
| Fast growth (40%→20%) | 8,916 | $89,459 | $58,268 | 5,197% |
| Flat (1,000 users, no growth) | 1,000 | $21,816 | $12,000 | 991% |

### ROI Including Marketing Spend

| Scenario (free 1/day) | Total Investment | 12-mo Profit | ROI |
|------------------------|-----------------|-------------|-----|
| Base + $500/mo marketing | $7,100 | $288 | -96% |
| Base + $1,000/mo marketing | $13,100 | -$5,712 | -144% |

| Scenario (free 1/week) | Total Investment | 12-mo Profit | ROI |
|-------------------------|-----------------|-------------|-----|
| Base + $500/mo marketing | $7,100 | $22,616 | 218% |
| Base + $1,000/mo marketing | $13,100 | $16,616 | 27% |

**Critical insight**: With 1/day free tier, adding any marketing budget makes the business unprofitable in the first 12 months — free generation costs grow faster than revenue. With 1/week free tier, there is healthy room for marketing spend. This is the core tension: aggressive free tier helps acquisition but destroys unit economics.

---

## 11. Unit Economics

### Customer Lifetime Value (LTV)

| Segment | Avg Monthly Spend | Est. Retention (months) | LTV |
|---------|------------------|------------------------|-----|
| Starter buyer | $9.99 | 4 | $39.96 |
| Plus buyer | $19.99 | 6 | $119.94 |
| Pro buyer | $49.99 | 8 | $399.92 |
| Blended (weighted) | $24.24 × 1.5 | 5 | **$181.80** |

### Blended LTV After Costs

| Metric | Value |
|--------|-------|
| Blended LTV (revenue) | $181.80 |
| Stripe fees (4.4% avg) | -$8.00 |
| fal.ai generation costs | -$81.38 |
| ElevenLabs narration (20% add-on) | -$0.75 |
| Infrastructure share per paying user | -$2.10 |
| **Net LTV** | **$89.57** |
| Maximum CAC for profitability | **$89.57** |
| Recommended CAC target (3:1 LTV:CAC) | **$29.86** |

Note: Infrastructure share is negligible per user (~$0.42/mo at 10K users). fal.ai generation costs dominate LTV erosion at 44.8% of gross LTV.

---

## 12. Risk Factors

### Revenue & Margin Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| fal.ai raises prices | Margin compression (e.g., Kling $0.35→$0.50 cuts margin from 50% to 29%) | Multi-provider strategy, credit cost adjustment via feature flag |
| Low conversion (<2%) | Revenue doesn't cover free tier costs | Reduce free tier to 1/week via feature flag |
| High free tier abuse | Bot accounts consuming free generations | Rate limiting + device fingerprinting + hCaptcha (feature-flagged) |
| Stripe chargebacks | Revenue clawback + $15 dispute fee | Clear refund policy, usage-based (non-refundable) |
| Credit hoarding (low spend-through) | Revenue recognized but costs deferred | Credits never expire = liability on books; monitor spend-through rate |
| Model mix shifts to expensive models | Margin drops from 48.6% to ~40% | Adjust credit costs upward for expensive models |
| ElevenLabs raises prices or discontinues flash model | Narration margin compression | Narration credit cost adjustable via feature flag config |

### Infrastructure Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Upstash Redis command explosion | 9 modules hit Redis on every user action; at 10K DAU could hit millions of cmds/month ($75+/mo) | Monitor command volume, batch operations, increase cache TTLs |
| Vercel cron invocation overages | 5 cron jobs at 1-min intervals = 225K/mo from crons alone; user traffic adds more | Reduce cron frequency (vote sync every 2-3 min instead of 1 min), consolidate crons |
| Supabase realtime connection limits | 7 channels with postgres_changes; Pro plan limits concurrent WebSocket connections | Monitor connection count, Supabase Pro allows 500 concurrent; may need Team plan at scale |
| Supabase database size | 21 tables + materialized views + transaction logs grow over time | Archive old data, partition `credit_transactions` by month |
| Sentry event volume | 10% trace sampling + 10% session replay can exceed free tier quickly | Reduce sampling rates, or budget $26/mo for Developer plan |
| R2 storage accumulation | Every submitted video stored permanently | cleanup-videos cron already handles expired generations; monitor bucket size |

### Operational Risk: Free Tier Dominates All Other Costs

At every scale tested, fal.ai free generation costs are **70%+ of total costs**. All infrastructure services combined are <2% of costs. This means:
- Optimizing infrastructure (cheaper Redis, fewer crons) saves at most $100-200/mo
- Changing free tier from 1/day to 1/week saves **$8,905/mo at 10K users**
- The business is essentially a free tier management problem, not an infrastructure cost problem

---

## 13. Break-Even Analysis

| Scenario | Infrastructure/mo | Free Gen Cost Model | Break-Even Users |
|----------|-------------------|--------------------|-----------------|
| Free 1/day | ~$59-$211 (scales) | $0.35 × DAU × 30% × 30 days | **~2,800** |
| Free 1/3 days | ~$59-$211 (scales) | $0.35 × DAU × 30% × 10 days | **~800** |
| Free 1/week | ~$59-$211 (scales) | $0.35 × DAU × 30% × 4.3 days | **~350** |
| No free tier | ~$59-$211 (scales) | $0 | **~120** |

**Why break-even is high with 1/day free:** At 2,800 users, free generation costs alone are $2,910/mo ($0.35 × 924 DAU × 30% × 30). This nearly equals the gross revenue from 140 paying users ($1,818 × 2.8 ≈ $5,090). Infrastructure adds another $80+. Revenue barely covers costs.

**Why infrastructure doesn't matter much for break-even:** Even at 10K users, all infrastructure combined ($211/mo) equals roughly 20 free Kling generations. One free user generating daily for a month costs more than running Sentry for the entire platform.

**Recommendation**: Launch with 1/day free tier for acquisition, monitor free gen costs weekly via admin AI stats dashboard, switch to 1/3 days or 1/week when free costs exceed 60% of gross revenue. The `credit_system` feature flag has `free_generation_interval_days` — changeable instantly without code deploy.

---

## 14. Raw Data for Claude Analysis

```json
{
  "packages": [
    {"id": "starter", "price_usd": 9.99, "credits": 100, "bonus": 0, "total": 100},
    {"id": "plus", "price_usd": 19.99, "credits": 200, "bonus": 20, "total": 220},
    {"id": "pro", "price_usd": 49.99, "credits": 500, "bonus": 75, "total": 575},
    {"id": "custom", "price_per_credit_usd": 0.10, "bonus": 0, "min_usd": 1.00, "max_usd": 500.00}
  ],
  "model_costs": {
    "kling-2.6": {"platform_cost_usd": 0.35, "credits": 7, "user_pays_usd": 0.70},
    "hailuo-2.3": {"platform_cost_usd": 0.49, "credits": 10, "user_pays_usd": 1.00},
    "veo3-fast": {"platform_cost_usd": 0.80, "credits": 15, "user_pays_usd": 1.50},
    "sora-2": {"platform_cost_usd": 0.80, "credits": 15, "user_pays_usd": 1.50}
  },
  "narration_cost": {"platform_cost_usd": 0.05, "credits": 1, "user_pays_usd": 0.10},
  "stripe_fee": {"percent": 2.9, "fixed_usd": 0.30},
  "model_usage_mix": {"kling-2.6": 0.40, "hailuo-2.3": 0.25, "veo3-fast": 0.20, "sora-2": 0.15},
  "weighted_avg": {
    "credits_per_gen": 10.55,
    "platform_cost_per_gen_usd": 0.5425,
    "revenue_per_gen_usd": 1.055,
    "margin_per_gen_usd": 0.5125,
    "margin_pct": 48.6
  },
  "assumptions": {
    "dau_ratio": 0.33,
    "paying_conversion": 0.05,
    "avg_purchases_per_buyer_per_month": 1.5,
    "free_gen_utilization": 0.30,
    "narration_addon_rate": 0.20,
    "credit_breakage_rate": 0.08,
    "package_distribution": {"starter": 0.30, "plus": 0.40, "pro": 0.25, "custom": 0.05},
    "weighted_avg_transaction_usd": 24.24
  },
  "infrastructure_costs": {
    "description": "Based on full codebase audit (2026-02-03). 11 paid services identified.",
    "fixed_monthly": {
      "vercel_pro": 20.00,
      "domain": 1.50,
      "stripe": 0.00,
      "total": 21.50
    },
    "scaling_at_1k_users": {
      "supabase_pro": 25.00,
      "upstash_redis": 10.00,
      "cloudflare_r2": 2.00,
      "cloudflare_worker": 0.00,
      "sentry": 0.00,
      "vercel_overages": 0.00,
      "total_scaling": 37.00,
      "total_with_fixed": 58.50
    },
    "scaling_at_5k_users": {
      "supabase_pro": 25.00,
      "upstash_redis": 35.00,
      "cloudflare_r2": 8.00,
      "cloudflare_worker": 5.00,
      "sentry": 13.00,
      "vercel_overages": 5.00,
      "total_scaling": 96.00,
      "total_with_fixed": 117.50
    },
    "scaling_at_10k_users": {
      "supabase_pro": 50.00,
      "upstash_redis": 75.00,
      "cloudflare_r2": 15.00,
      "cloudflare_worker": 8.00,
      "sentry": 26.00,
      "vercel_overages": 15.00,
      "total_scaling": 189.00,
      "total_with_fixed": 210.50
    },
    "key_cost_drivers": [
      "Upstash Redis: 9 modules (rate-limit, session, vote-queue, comment-queue, leaderboard, seen-tracking, vote-cache, crdt-counter, vote-validation). Commands scale linearly with every user action.",
      "Vercel crons: 5 jobs at 1-min intervals = 225K invocations/month before user traffic.",
      "Supabase realtime: 7 channels with postgres_changes. Concurrent WebSocket connections bill at scale.",
      "Cloudflare R2: Video storage grows permanently. Currently ~$0.015/GB/month."
    ]
  },
  "cost_dominance_at_10k_users": {
    "fal_ai_free_gens_pct": 70.1,
    "fal_ai_paid_gens_pct": 27.4,
    "all_infrastructure_pct": 1.4,
    "elevenlabs_pct": 0.5,
    "note": "fal.ai is 97.5% of non-Stripe costs. Infrastructure is a rounding error."
  },
  "free_tier": {
    "generations_per_day": 1,
    "model": "kling-2.6",
    "cost_per_free_gen_usd": 0.35,
    "free_includes_narration": true,
    "free_narration_cost_usd": 0.05
  },
  "irr_cash_flows_free_1_per_day": [-1100, 96, 150, 183, 260, 338, 468, 543, 629, 715, 820, 968, 1118],
  "irr_cash_flows_free_1_per_week": [-1100, 463, 627, 775, 1068, 1386, 1826, 2114, 2450, 2828, 3257, 3761, 4324],
  "twelve_month_summary": {
    "free_1_per_day": {
      "total_revenue": 45611,
      "total_costs": 39323,
      "total_profit": 6288,
      "roi_pct": 471,
      "payback_month": 5
    },
    "free_1_per_week": {
      "total_revenue": 45611,
      "total_costs": 16995,
      "total_profit": 28616,
      "roi_pct": 2501,
      "payback_month": 2
    }
  },
  "growth_model": {
    "starting_users": 500,
    "months_1_6_growth": 0.30,
    "months_7_12_growth": 0.15
  }
}
```

---

## 15. Questions for Analysis

1. What is the exact IRR given the cash flow array above?
2. At what conversion rate does the free tier (1/day) become unprofitable?
3. What is the optimal free tier frequency to maximize LTV while maintaining acquisition?
4. If fal.ai raises prices by 30%, what credit cost adjustments maintain 40%+ margins?
5. What package distribution maximizes profit (vs current 30/40/25/5 assumption)?
6. Should the Pro pack bonus be reduced from 75→50 to protect margins?
7. At what user count does adding a $99.99 "Studio" pack (1000 credits + 200 bonus) become worthwhile?
8. What is the sensitivity of IRR to the user growth rate assumption?
