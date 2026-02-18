# aimoviez — Cost of Operation Analysis

## Fixed Monthly Costs (Infrastructure)

| Service | Plan | Monthly Cost | What You Get |
|---------|------|-------------|-------------|
| **Vercel Pro** | Pro | **$20** | SSR hosting, 6 cron jobs (5x/min), edge middleware, analytics |
| **Supabase** | Free → Pro | **$0 – $25** | PostgreSQL, Realtime WebSockets, Storage (500MB free) |
| **Cloudflare** | Free | **$0** | DNS, CDN, 1 Worker (100K req/day free), R2 (10GB free) |
| **Sentry** | Free → Team | **$0 – $26** | Error monitoring (5K errors/mo free), 5-10% sampling |
| **Google OAuth** | Free | **$0** | Authentication |
| **hCaptcha** | Free | **$0** | Bot protection (1M/mo free, feature-flagged off) |
| **DiceBear** | Free | **$0** | Avatar generation API |
| | | | |
| **Fixed subtotal** | | **$20 – $71/mo** | |

---

## Variable Costs by Traffic Scenario

### Assumptions
- 1 page load = ~3 Redis calls + ~5 DB queries + 1 Realtime connection
- 1 vote = ~10 Redis calls + ~4 DB queries + 1 Realtime broadcast
- 1 AI generation = $0.35–$0.80 fal.ai cost
- Average video size = 15MB stored on R2
- Cron overhead = 7,500 invocations/day (constant regardless of traffic)

---

### Scenario A: Early Stage (100 DAU, 500 votes/day, 5 AI gens/day)

| Cost Center | Calculation | Monthly |
|-------------|-------------|---------|
| **Vercel** (serverless) | ~10K function invocations/day + crons | included in Pro |
| **Supabase** (DB) | ~65K queries/day → free tier | **$0** |
| **Upstash Redis** | ~8K cmds/day (votes) + ~9K (page loads) + ~5K (crons) = ~22K/day → 660K/mo | **$0.13** |
| **Cloudflare R2** (storage) | ~150 videos x 15MB = 2.25GB stored | **$0.03** |
| **Cloudflare R2** (operations) | ~5K writes + ~100K reads/mo | **$0.06** |
| **fal.ai** (AI gen) | 5/day x 30 x avg $0.50 | **$75** |
| **Variable subtotal** | | **~$75/mo** |
| **Total (A)** | | **~$95–$146/mo** |

**Dominant cost: fal.ai at ~80% of variable spend**

---

### Scenario B: Growing (1,000 DAU, 5,000 votes/day, 50 AI gens/day)

| Cost Center | Calculation | Monthly |
|-------------|-------------|---------|
| **Vercel** (serverless) | ~100K invocations/day | included in Pro |
| **Supabase** (DB) | ~650K queries/day → may need Pro | **$25** |
| **Supabase** (Realtime) | ~200 concurrent connections | included in Pro |
| **Upstash Redis** | ~80K/day (votes) + ~90K (loads) + ~5K (crons) = ~175K/day → 5.25M/mo | **$1.05** |
| **Cloudflare R2** (storage) | ~1,500 videos x 15MB = 22.5GB | **$0.34** |
| **Cloudflare R2** (operations) | ~50K writes + ~1M reads/mo | **$0.59** |
| **Cloudflare R2** (egress) | FREE via custom domain | **$0** |
| **fal.ai** (AI gen) | 50/day x 30 x avg $0.50 | **$750** |
| **Variable subtotal** | | **~$777/mo** |
| **Total (B)** | | **~$797–$848/mo** |

**fal.ai is 96% of variable cost. Everything else is negligible.**

---

### Scenario C: Scale (10,000 DAU, 50,000 votes/day, 200 AI gens/day)

| Cost Center | Calculation | Monthly |
|-------------|-------------|---------|
| **Vercel** (serverless) | ~1M invocations/day, may need Enterprise | **$20–$400** |
| **Supabase Pro** | ~6.5M queries/day, high connection count | **$25–$100** |
| **Supabase** (Realtime) | ~2,000 concurrent connections | may need addon |
| **Upstash Redis** | ~800K/day (votes) + ~900K (loads) + ~5K (crons) = ~1.7M/day → 51M/mo | **$10.20** |
| **Cloudflare R2** (storage) | ~6,000 videos x 15MB = 90GB | **$1.35** |
| **Cloudflare R2** (operations) | ~200K writes + ~10M reads/mo | **$4.50** |
| **fal.ai** (AI gen) | 200/day x 30 x avg $0.50 | **$3,000** |
| **Sentry** (if enabled) | High event volume → Team plan | **$26** |
| **Variable subtotal** | | **~$3,067–$3,542/mo** |
| **Total (C)** | | **~$3,087–$3,613/mo** |

**Hard cap: fal.ai capped at $50/day = $1,500/mo in code. So actual max fal.ai = $1,500.**
**With cap: Total (C) = ~$1,587–$2,113/mo**

---

## fal.ai Deep Dive (The Real Cost Driver)

### Per-Model Cost
| Model | Cost/Gen | Typical Use | % of Generations (est.) |
|-------|----------|-------------|------------------------|
| Kling 2.6 | **$0.35** | Cheapest, free daily option | 60% |
| Hailuo 2.3 | **$0.49** | Mid-tier quality | 20% |
| Veo3 Fast | **$0.80** | High quality | 10% |
| Sora 2 | **$0.80** | High quality | 10% |

**Weighted average cost per generation: ~$0.47**

### Built-in Cost Controls
| Control | Value | Effect |
|---------|-------|--------|
| Daily per-user limit | 1 free gen/day (DB default) | Caps individual abuse |
| Daily global cost cap | **$50/day** | Hard stop at ~100-143 gens/day |
| Monthly global cost cap | **$1,500/month** | Hard stop on monthly spend |
| Rate limit | 3 requests/min/IP | Prevents rapid-fire generation |
| Keyword blocklist | 7 blocked terms | Reduces wasted generations on TOS violations |
| Timeout cleanup | Every 5 min | Cancels stuck generations |

### Maximum Possible fal.ai Spend
- **Daily cap**: $50 → 62 gens at weighted avg
- **Monthly cap**: $1,500 → ~3,191 total gens at weighted avg
- **These caps are enforced atomically in PostgreSQL** — race-safe

---

## Cost per User Metrics

| Metric | Scenario A (100 DAU) | Scenario B (1K DAU) | Scenario C (10K DAU) |
|--------|---------------------|--------------------|--------------------|
| Total monthly cost | $95–$146 | $797–$848 | $1,587–$2,113* |
| Cost per DAU/month | $0.95–$1.46 | $0.80–$0.85 | $0.16–$0.21 |
| Cost per DAU excl. AI | $0.20–$0.71 | $0.05–$0.10 | $0.009–$0.06 |
| AI cost per generation | ~$0.47 avg | ~$0.47 avg | ~$0.47 avg |

*With $1,500/mo fal.ai cap active

**Key insight**: Infrastructure scales efficiently (Cloudflare R2 free egress is huge for video). The only cost that doesn't scale down per-user is fal.ai generation, which is why the credit system is critical for monetization.

---

## Cost Optimization Opportunities

1. **R2 over Supabase Storage** — Already implemented but feature-flagged. Enabling `r2_storage` flag eliminates all video egress costs (Supabase charges for bandwidth, R2 doesn't via custom domain).

2. **Reduce cron frequency** — 5 crons at 1/min = 216K invocations/mo. Could reduce `sync-leaderboards` and `sync-vote-counters` to every 5 min (saves ~130K invocations, reduces Redis calls ~80%).

3. **Redis command batching** — Already using pipelines extensively. Current architecture is well-optimized.

4. **Supabase connection pooling** — Each serverless function creates a new Supabase client. At scale, connection exhaustion is a risk. Consider PgBouncer/Supavisor (included in Supabase Pro).

5. **Credit system** — The planned credit system directly offsets fal.ai costs. At 30-47% margins, break-even requires ~$1,500/mo in credit purchases to fully offset the fal.ai cap.

---

## Break-Even Analysis (with Credit System)

Using the credit system from the financial model:

| Monthly AI Spend | Credit Revenue Needed (40% margin) | Package Sales Needed |
|-----------------|-----------------------------------|--------------------|
| $75 (Scenario A) | $125 | ~31 Starter or ~16 Pro packs |
| $750 (Scenario B) | $1,250 | ~314 Starter or ~157 Creator packs |
| $1,500 (cap, Scenario C) | $2,500 | ~314 Pro or ~313 Studio packs |

With 1,000 DAU and 5% conversion to paid: **50 paying users x ~$4/mo = $200/mo revenue** — covers Scenario A but not B.

To cover Scenario B ($848/mo), need either:
- Higher conversion (21% at $4/mo avg), or
- Higher ARPU (~$17/mo from 50 users), or
- Tighter free tier (remove free daily generation)

---

## Full Service Inventory

| Service | Status | Cost |
|---------|--------|------|
| Vercel (hosting/cron) | Active | $20/mo + usage |
| Supabase (DB/storage/realtime) | Active | $0–$25/mo |
| Upstash Redis (cache/queues) | Active | Pay-per-command |
| Cloudflare R2 (video CDN) | Feature-flagged | ~$0.015/GB |
| Cloudflare Worker (edge rate limit) | Active | Free tier |
| fal.ai (AI video gen) | Active | $0.35–$0.80/gen |
| Google OAuth | Active | Free |
| Sentry (error monitoring) | Conditional | Free–$26/mo |
| hCaptcha | Feature-flagged off | Free |
| DiceBear (avatars) | Active | Free |
| Cloudinary | Code exists, NOT configured | $0 |
| AWS S3 | Placeholder only | $0 |
| Web Push (VAPID) | Not configured | $0 |
| Stripe | Not yet implemented | $0 |
