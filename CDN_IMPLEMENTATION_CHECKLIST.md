# CDN Implementation Checklist

## Goal
Add Cloudflare CDN + video compression to improve video loading speed for 10K+ users.

**Expected Result:** Videos load 4-6x faster, no monthly cost.

---

## Prerequisites (5 min)
- [ ] Cloudflare account (free) - https://cloudflare.com
- [ ] Access to your domain's DNS settings
- [ ] Supabase dashboard access

---

## Part 1: Cloudflare CDN Proxy (30-45 min)

### Step 1: Add domain to Cloudflare
- [ ] Add your domain to Cloudflare
- [ ] Update nameservers at your registrar
- [ ] Wait for DNS propagation (usually 5-30 min)

### Step 2: Create CDN route for videos
- [ ] In Cloudflare, go to Rules → Transform Rules
- [ ] Create URL rewrite: `cdn.yourdomain.com/videos/*` → Supabase Storage URL
- [ ] Or simpler: Create a CNAME `cdn.yourdomain.com` → your Supabase storage host

### Step 3: Configure caching
- [ ] Cache Rules → Create rule for `/videos/*`
- [ ] Set Edge TTL: 1 month (videos don't change)
- [ ] Enable "Cache Everything"

### Step 4: Update video URLs in code
- [ ] Change `getPublicUrl()` to return CDN URL
- [ ] Pattern: `https://cdn.yourdomain.com/videos/{path}`
- [ ] File to modify: `src/app/api/upload/route.ts` (around line 386)

### Step 5: Test
- [ ] Upload a test video
- [ ] Check video loads from CDN URL
- [ ] Verify Cloudflare cache header: `cf-cache-status: HIT`

---

## Part 2: Video Compression (1-2 hours)

### Step 1: Add FFmpeg to upload flow
- [ ] Option A: Use `@ffmpeg/ffmpeg` (client-side, WebAssembly)
- [ ] Option B: Use server-side FFmpeg (better quality, needs server)
- [ ] Add compression after upload, before saving URL

### Step 2: Compression settings
```
Target: 720p, H.264, AAC audio
Bitrate: 1.5-2 Mbps
Result: 8-sec video = ~1.5MB (vs 5-15MB raw)

FFmpeg command example:
ffmpeg -i input.mp4 -vf "scale=1280:720" -c:v libx264 -b:v 1500k -c:a aac -b:a 128k output.mp4
```

### Step 3: Test compression
- [ ] Upload test video
- [ ] Verify output quality acceptable
- [ ] Check file size reduction

---

## Verification Checklist

- [ ] Video loads fast on mobile (use Chrome DevTools → Network → 3G throttling)
- [ ] Cloudflare Analytics shows cache hits
- [ ] No broken video URLs in dashboard
- [ ] No broken video URLs in story page
- [ ] Upload still works correctly
- [ ] Existing videos still play (backward compatible)

---

## Rollback Plan (if issues)

```bash
# Revert video URL pattern in code
git revert HEAD
git push
```

---

## Time Estimate

| Task | Time |
|------|------|
| Cloudflare setup | 30 min |
| Code changes | 30 min |
| Video compression | 1-2 hours |
| Testing | 30 min |
| **Total** | **2-3 hours** |

---

## Files to Modify

1. `src/app/api/upload/route.ts` - Change video URL generation
2. `src/lib/video-storage.ts` - Add compression logic (if using)
3. `.env.local` - Add CDN URL environment variable

---

## Environment Variables to Add

```env
# Cloudflare CDN
NEXT_PUBLIC_CDN_URL=https://cdn.yourdomain.com
```

---

## Future Scaling (when needed)

After this CDN work, the next scaling steps are:

1. **100K users** - Add Redis caching for hot data (~2 hours)
2. **500K users** - Upgrade Supabase plan (~$50/mo)
3. **1M users** - Upgrade Vercel + monitor database (~$300/mo total)

The CDN fix solves video delivery permanently - it scales to millions.
