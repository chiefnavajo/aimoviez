# âœ… HYBRID ROUTING SYSTEM - Implementation Checklist

Copy this checklist and check off items as you complete them.

---

## ðŸ“¦ PRE-REQUISITES

- [ ] Next.js 14+ project initialized
- [ ] Tailwind CSS configured
- [ ] Supabase account & project created
- [ ] Node.js 18+ installed
- [ ] Git repository set up

---

## ðŸ—‚ï¸ STEP 1: File Structure Setup (15 min)

### Create Directories
- [ ] `mkdir -p app/story`
- [ ] `mkdir -p app/dashboard`
- [ ] `mkdir -p app/upload`
- [ ] `mkdir -p app/profile`
- [ ] `mkdir -p components`
- [ ] `mkdir -p lib`

### Copy Files
- [ ] Copy `app-page.tsx` â†’ `app/page.tsx`
- [ ] Copy `layout.tsx` â†’ `app/layout.tsx`
- [ ] Copy `story-page-integrated.tsx` â†’ `app/story/page.tsx`
- [ ] Copy `dashboard-page-integrated.tsx` â†’ `app/dashboard/page.tsx`
- [ ] Copy `BottomNavigation.tsx` â†’ `components/BottomNavigation.tsx`
- [ ] Copy `OnboardingOverlay.tsx` â†’ `components/OnboardingOverlay.tsx`
- [ ] Copy `lib-analytics.ts` â†’ `lib/analytics.ts`

### Create Placeholder Pages
- [ ] Create `app/upload/page.tsx` (simple placeholder)
- [ ] Create `app/profile/page.tsx` (simple placeholder)

---

## ðŸ“š STEP 2: Dependencies (5 min)

### Install Required Packages
```bash
npm install @tanstack/react-query framer-motion lucide-react
```

- [ ] `@tanstack/react-query` installed
- [ ] `framer-motion` installed
- [ ] `lucide-react` installed
- [ ] Run `npm install` successfully
- [ ] No peer dependency warnings

### Verify Existing Dependencies
- [ ] `next` (v14+)
- [ ] `react` (v18+)
- [ ] `react-dom` (v18+)
- [ ] `tailwindcss` configured

---

## âš™ï¸ STEP 3: Configuration (10 min)

### TypeScript Configuration
Update `tsconfig.json`:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```
- [ ] TypeScript paths configured
- [ ] No TypeScript errors in IDE

### Environment Variables
Create `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=your_url_here
SUPABASE_SERVICE_ROLE_KEY=your_key_here
NEXT_PUBLIC_ANALYTICS_PROVIDER=console
```
- [ ] `.env.local` created
- [ ] Supabase URL added
- [ ] Service role key added
- [ ] Analytics provider set (default: console)

### Tailwind Configuration (if needed)
- [ ] `tailwind.config.js` includes all content paths
- [ ] Custom colors added (optional)

---

## ðŸ”§ STEP 4: Import Path Updates (10 min)

### Update All Import Statements
Go through each copied file and replace relative imports with absolute:

**In all files:**
- [ ] Replace `'./OnboardingOverlay'` with `'@/components/OnboardingOverlay'`
- [ ] Replace `'./BottomNavigation'` with `'@/components/BottomNavigation'`
- [ ] Replace `'../lib/analytics'` with `'@/lib/analytics'`

**Specific files to check:**
- [ ] `app/page.tsx`
- [ ] `app/story/page.tsx`
- [ ] `app/dashboard/page.tsx`
- [ ] `components/BottomNavigation.tsx`

---

## ðŸŽ¨ STEP 5: Styling (15 min)

### Global Styles
Create/update `app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* { box-sizing: border-box; }
html, body { height: 100%; }
body { 
  background: #000; 
  color: #fff; 
  overscroll-behavior-y: contain;
}
```
- [ ] Tailwind directives added
- [ ] Global styles added
- [ ] Import in `layout.tsx`: `import './globals.css'`

### Font Loading
- [ ] Google Fonts link added to `layout.tsx` (Orbitron + Space Grotesk)
- [ ] Or fonts installed locally

### Test Styling
- [ ] Background is black
- [ ] Text is white
- [ ] Gradients rendering correctly

---

## ðŸ§ª STEP 6: Local Testing (20 min)

### First Run
```bash
npm run dev
```
- [ ] Development server starts without errors
- [ ] No console errors in terminal
- [ ] App loads at `http://localhost:3000`

### Test First-Time User Flow
1. Clear localStorage: `localStorage.clear()`
2. Refresh page
3. Verify:
   - [ ] Lands on Story Page
   - [ ] Onboarding overlay appears
   - [ ] Can navigate through 3 screens
   - [ ] "Let's Go!" button works
   - [ ] Redirects to `/dashboard` (Voting Arena)

### Test Returning User Flow
1. Refresh page
2. Verify:
   - [ ] Auto-redirects to `/dashboard`
   - [ ] No onboarding shown
   - [ ] Lands directly on Voting Arena

### Test Navigation
- [ ] Story tab navigates to `/story`
- [ ] Shorts tab navigates to `/dashboard`
- [ ] Upload tab navigates to `/upload`
- [ ] Profile tab navigates to `/profile`
- [ ] Active tab is highlighted
- [ ] Navigation animation smooth

### Test Onboarding Skip
1. Clear localStorage
2. Refresh page
3. Click "Skip" button
4. Verify:
   - [ ] Onboarding closes
   - [ ] `has_visited_before` set to `true`

---

## ðŸ“Š STEP 7: Analytics Setup (15 min)

### Development Mode
- [ ] Console logs showing analytics events
- [ ] Check console for: `ðŸ“Š Analytics: Event Name`
- [ ] Verify tracking on:
  - App Opened
  - Page View
  - Navigation Tab Clicked
  - Onboarding events

### Production Setup (Optional)
Choose one:

**Segment:**
```bash
npm install @segment/analytics-next
```
- [ ] Segment installed
- [ ] Write key in `.env.local`
- [ ] Initialized in `layout.tsx`

**PostHog:**
```bash
npm install posthog-js
```
- [ ] PostHog installed
- [ ] API key in `.env.local`
- [ ] Initialized in `layout.tsx`

**Mixpanel:**
```bash
npm install mixpanel-browser
```
- [ ] Mixpanel installed
- [ ] Token in `.env.local`
- [ ] Initialized in `layout.tsx`

---

## ðŸ—„ï¸ STEP 8: Database Integration (30 min)

### Run Migrations
- [ ] Execute `migration.sql` in Supabase SQL Editor
- [ ] Verify tables created:
  - `seasons`
  - `story_slots`
  - `tournament_clips`
  - `votes`
  - `slot_reminders`

### Create Test Data
- [ ] Create active season
- [ ] Create 75 story_slots
- [ ] Upload test clips (at least 5)
- [ ] Set slot #23 to `status = 'voting'`

### Test API Endpoints
```bash
# Test GET /api/vote
curl http://localhost:3000/api/vote?trackId=track-main

# Test GET /api/story
curl http://localhost:3000/api/story
```
- [ ] GET `/api/vote` returns clips
- [ ] GET `/api/story` returns season + slots
- [ ] No 404/500 errors

---

## ðŸ“± STEP 9: Mobile Testing (20 min)

### Responsive Design
- [ ] Test on Chrome DevTools (mobile view)
- [ ] Test iPhone 13 Pro viewport (390Ã—844)
- [ ] Test iPad Air viewport (820Ã—1180)
- [ ] All elements visible and clickable

### Real Device Testing
Get local IP: `ifconfig | grep inet`
- [ ] App accessible from phone: `http://192.168.x.x:3000`
- [ ] Touch gestures work (swipe, tap)
- [ ] Bottom nav visible and functional
- [ ] No horizontal scrolling issues

### Performance on Mobile
- [ ] Animations smooth (60fps)
- [ ] No lag when swiping
- [ ] Vote button responsive
- [ ] Images load quickly

---

## ðŸ”’ STEP 10: Security & Error Handling (15 min)

### Error Boundaries
- [ ] 404 page created
- [ ] Error page created (`app/error.tsx`)
- [ ] Loading states implemented

### Input Validation
- [ ] API routes validate input
- [ ] SQL injection prevented (using Supabase client)
- [ ] XSS prevented (React escapes by default)

### Rate Limiting (if implemented)
- [ ] Vote endpoint throttled
- [ ] API endpoints have rate limits

---

## ðŸš€ STEP 11: Pre-Deployment (30 min)

### Build Test
```bash
npm run build
```
- [ ] Build completes without errors
- [ ] No TypeScript errors
- [ ] No ESLint errors (if configured)
- [ ] Bundle size acceptable (<500KB)

### Lighthouse Audit
```bash
npm run build
npm run start
# Open http://localhost:3000
# Run Lighthouse in Chrome DevTools
```
Target scores:
- [ ] Performance: 90+
- [ ] Accessibility: 95+
- [ ] Best Practices: 90+
- [ ] SEO: 95+

### Environment Variables (Production)
In hosting dashboard (Vercel/Netlify):
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `NEXT_PUBLIC_ANALYTICS_PROVIDER`
- [ ] Analytics provider keys (if using)

---

## ðŸŒ STEP 12: Deployment (20 min)

### Deploy to Vercel
```bash
vercel --prod
```
- [ ] Deployment successful
- [ ] Production URL works
- [ ] All env vars set
- [ ] No runtime errors

### Post-Deployment Checks
- [ ] Visit production URL
- [ ] Test first-time user flow
- [ ] Test returning user flow
- [ ] Test all navigation tabs
- [ ] Check analytics (production provider)
- [ ] Test on real mobile device

---

## ðŸ“ˆ STEP 13: Monitoring Setup (15 min)

### Analytics Dashboard
- [ ] Segment/PostHog dashboard accessible
- [ ] Events showing up in real-time
- [ ] Set up key metric dashboards:
  - Daily Active Users
  - Onboarding completion rate
  - Vote engagement rate
  - Navigation usage

### Error Tracking
Optional (but recommended):
```bash
npm install @sentry/nextjs
```
- [ ] Sentry configured
- [ ] Errors being captured
- [ ] Alerts set up for critical errors

### Performance Monitoring
- [ ] Vercel Analytics enabled (free tier)
- [ ] Or Google Analytics 4 configured
- [ ] Core Web Vitals tracked

---

## âœ… FINAL CHECKLIST

### User Experience
- [ ] First-time users see onboarding
- [ ] Returning users skip directly to voting
- [ ] Navigation always accessible
- [ ] All pages load <2 seconds
- [ ] Mobile experience polished

### Technical
- [ ] No console errors
- [ ] No memory leaks
- [ ] Analytics tracking all events
- [ ] Database queries optimized
- [ ] API responses cached

### Documentation
- [ ] README updated with setup instructions
- [ ] Environment variables documented
- [ ] Deployment guide written
- [ ] Known issues documented

### Team Readiness
- [ ] Team members can run locally
- [ ] Code review completed
- [ ] QA testing passed
- [ ] Stakeholders approved

---

## ðŸŽ‰ LAUNCH!

- [ ] Production URL shared with team
- [ ] Soft launch to beta users
- [ ] Monitor analytics for first 24h
- [ ] Collect user feedback
- [ ] Plan iteration based on data

---

## ðŸ“Š Post-Launch Metrics to Track

### Week 1
- [ ] Total users
- [ ] Onboarding completion rate (target: >80%)
- [ ] Returning user rate (target: >60%)
- [ ] Average votes per user (target: >50)
- [ ] Error rate (target: <0.1%)

### Week 2-4
- [ ] Day 7 retention
- [ ] Navigation usage distribution
- [ ] Peak hours traffic
- [ ] Performance metrics (Core Web Vitals)
- [ ] Feature requests from users

---

## ðŸ› Troubleshooting Checklist

If something doesn't work:

- [ ] Check browser console for errors
- [ ] Check terminal/server logs
- [ ] Verify localStorage values
- [ ] Check network tab for API calls
- [ ] Clear cache and hard reload
- [ ] Test in incognito mode
- [ ] Check environment variables
- [ ] Verify database connection
- [ ] Review recent code changes
- [ ] Check analytics for patterns

---

## ðŸ“ž Support Resources

- Full guide: `HYBRID-ROUTING-GUIDE.md`
- Quick reference: `QUICK-REFERENCE.md`
- Visual diagram: `SYSTEM-DIAGRAM.md`
- Analytics docs: `lib/analytics.ts`

---

**Estimated Total Time:** 4-5 hours
**Difficulty:** Intermediate
**Team Size:** 1-2 developers

---

**Good luck!** ðŸš€

Remember: Test thoroughly in development before deploying to production.

**Questions?** Review the documentation files or check console logs for debugging hints.
