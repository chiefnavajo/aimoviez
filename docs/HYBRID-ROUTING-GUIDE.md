# 🚀 HYBRID ROUTING SYSTEM - Complete Integration Guide

## 📦 What You Got

A **complete smart routing system** that gives first-time users Story Page + Onboarding, and returning users direct access to Voting Arena.

### Files Created:
1. ✅ `app-page.tsx` - Smart routing root page
2. ✅ `BottomNavigation.tsx` - Dynamic navigation component
3. ✅ `story-page-integrated.tsx` - Story Page with onboarding
4. ✅ `dashboard-page-integrated.tsx` - Voting Arena
5. ✅ `layout.tsx` - Main layout with QueryClient
6. ✅ `lib-analytics.ts` - Analytics utility
7. ✅ This guide

---

## 🎯 How It Works

### User Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ USER OPENS APP (/)                                           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
         Check localStorage
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
  [First Time]        [Returning]
        │                   │
        │                   │
  Story Page         Auto-redirect
     +                  to /dashboard
  Onboarding              │
        │                 │
        ▼                 ▼
  "Let's Go!"      Voting Arena
        │                 │
        ▼                 │
  /dashboard ◄────────────┘
        │
        ▼
  Mark: has_visited_before = true
        │
        ▼
  [Future visits → direct to /dashboard]
```

---

## ⚡ Quick Integration (10 Steps)

### Step 1: Project Structure

Create this folder structure:

```
your-project/
├── app/
│   ├── page.tsx                        ← Copy app-page.tsx here
│   ├── layout.tsx                      ← Copy layout.tsx here
│   ├── dashboard/
│   │   └── page.tsx                    ← Copy dashboard-page-integrated.tsx here
│   ├── story/
│   │   └── page.tsx                    ← Copy story-page-integrated.tsx here
│   ├── upload/
│   │   └── page.tsx                    ← Create upload page
│   └── profile/
│       └── page.tsx                    ← Create profile page
├── components/
│   ├── OnboardingOverlay.tsx           ← Copy from previous package
│   └── BottomNavigation.tsx            ← Copy BottomNavigation.tsx here
└── lib/
    └── analytics.ts                    ← Copy lib-analytics.ts here
```

### Step 2: Install Dependencies

```bash
npm install @tanstack/react-query framer-motion lucide-react
```

### Step 3: Copy Files

```bash
# Root page
cp app-page.tsx app/page.tsx

# Layout
cp layout.tsx app/layout.tsx

# Components
cp BottomNavigation.tsx components/BottomNavigation.tsx
cp OnboardingOverlay.tsx components/OnboardingOverlay.tsx

# Pages
cp story-page-integrated.tsx app/story/page.tsx
cp dashboard-page-integrated.tsx app/dashboard/page.tsx

# Lib
cp lib-analytics.ts lib/analytics.ts
```

### Step 4: Environment Variables

Create `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Analytics (optional)
NEXT_PUBLIC_ANALYTICS_PROVIDER=console
# Options: console, segment, posthog, mixpanel, ga4

# For production, add your keys:
# NEXT_PUBLIC_SEGMENT_WRITE_KEY=...
# NEXT_PUBLIC_POSTHOG_KEY=...
# NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

### Step 5: Update Import Paths

In all copied files, update import paths:

```tsx
// Before:
import OnboardingOverlay from './OnboardingOverlay';
import BottomNavigation from './BottomNavigation';

// After:
import OnboardingOverlay from '@/components/OnboardingOverlay';
import BottomNavigation from '@/components/BottomNavigation';
```

Configure `tsconfig.json`:

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

### Step 6: Add Global Styles

In `app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  box-sizing: border-box;
}

html, body {
  height: 100%;
  overflow-x: hidden;
}

body {
  font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #000;
  color: #fff;
  overscroll-behavior-y: contain;
}

/* Hide scrollbar */
.hide-scrollbar::-webkit-scrollbar {
  display: none;
}
.hide-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* Prevent text selection on UI */
button {
  -webkit-user-select: none;
  user-select: none;
}

/* Remove tap highlight */
* {
  -webkit-tap-highlight-color: transparent;
}
```

### Step 7: Create Missing Pages

```tsx
// app/upload/page.tsx
export default function UploadPage() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center pb-20">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Upload Your Clip</h1>
        <p className="text-white/60">Coming soon...</p>
      </div>
    </div>
  );
}

// app/profile/page.tsx
export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center pb-20">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Your Profile</h1>
        <p className="text-white/60">Coming soon...</p>
      </div>
    </div>
  );
}
```

### Step 8: Test Locally

```bash
npm run dev
# Visit http://localhost:3000
```

**Test scenarios:**

1. **First visit:**
   - Clear localStorage: `localStorage.clear()` in console
   - Refresh page
   - Should see Story Page → Onboarding → Click "Let's Go!" → Voting Arena

2. **Second visit:**
   - Refresh page
   - Should auto-redirect to /dashboard (Voting Arena)

3. **Navigation:**
   - Click tabs in bottom nav
   - Should navigate between Story, Shorts, Upload, Profile

### Step 9: Add Analytics (Optional)

Install your analytics provider:

```bash
# Segment
npm install @segment/analytics-next

# PostHog
npm install posthog-js

# Mixpanel
npm install mixpanel-browser
```

Initialize in `app/layout.tsx`:

```tsx
// For Segment:
import { AnalyticsBrowser } from '@segment/analytics-next';

useEffect(() => {
  const analytics = AnalyticsBrowser.load({
    writeKey: process.env.NEXT_PUBLIC_SEGMENT_WRITE_KEY!
  });
  
  (window as any).analytics = analytics;
}, []);

// For PostHog:
import posthog from 'posthog-js';

useEffect(() => {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST
  });
  
  (window as any).posthog = posthog;
}, []);
```

### Step 10: Deploy

```bash
# Build for production
npm run build

# Deploy to Vercel
vercel --prod

# Or deploy to your hosting provider
```

---

## 🎨 Customization

### Change Default Landing for Returning Users

In `app/page.tsx`:

```tsx
// Current: Returning users → /dashboard
router.replace('/dashboard');

// Change to: Returning users → /story
router.replace('/story');
```

### Disable Onboarding Completely

```tsx
// In app/page.tsx:
setShouldShowStory(true); // Always show Story Page
// Remove the onboarding check
```

### Change Bottom Nav Items

In `components/BottomNavigation.tsx`:

```tsx
const navItems: NavItem[] = [
  // Add custom items:
  {
    id: 'discover',
    label: 'Discover',
    icon: Search,
    path: '/discover',
    color: 'from-blue-500 to-cyan-500',
  },
  // ... existing items
];
```

### Customize Analytics Events

In `lib/analytics.ts`, add custom trackers:

```tsx
export const trackMyCustomEvent = (data: any) => {
  analytics.track('My Custom Event', data);
};
```

---

## 📊 Analytics Events Reference

### Automatic Events:

| Event | When | Properties |
|-------|------|-----------|
| `App Opened` | User opens app | `user_type`, `has_onboarding_completed` |
| `App Initialized` | App loads | `user_agent`, `screen_size`, `device_type` |
| `Page View` | Route changes | `path`, `title`, `url` |
| `Navigation Tab Changed` | Bottom nav clicked | `from`, `to`, `path` |

### Manual Events (already integrated):

| Event | Trigger | File |
|-------|---------|------|
| `Onboarding Completed` | "Let's Go!" clicked | `story-page-integrated.tsx` |
| `Onboarding Skipped` | Skip button clicked | `story-page-integrated.tsx` |
| `Vote Cast` | ∞ button tapped | `dashboard-page-integrated.tsx` |
| `Clip Swiped` | User swipes | `dashboard-page-integrated.tsx` |
| `Slot Card Clicked` | Slot tapped | `story-page-integrated.tsx` |
| `CTA Clicked` | "Go to Voting" clicked | `story-page-integrated.tsx` |

---

## 🐛 Troubleshooting

### Issue 1: Onboarding shows every time

**Cause:** localStorage not persisting

**Fix:**
```tsx
// Check if browser supports localStorage
if (typeof Storage !== 'undefined') {
  localStorage.setItem('onboarding_completed', 'true');
} else {
  // Use cookies as fallback
  document.cookie = 'onboarding_completed=true; max-age=31536000';
}
```

### Issue 2: Auto-redirect loops

**Cause:** Conflicting routing logic

**Fix:**
```tsx
// In app/page.tsx, add guards:
const [isRedirecting, setIsRedirecting] = useState(false);

if (!isRedirecting && hasVisitedBefore) {
  setIsRedirecting(true);
  router.replace('/dashboard');
}
```

### Issue 3: Bottom nav not showing

**Cause:** Missing import or z-index issue

**Fix:**
```tsx
// Ensure BottomNavigation is imported:
import BottomNavigation from '@/components/BottomNavigation';

// Check z-index (should be z-40):
<BottomNavigation className="z-40" />
```

### Issue 4: Analytics not tracking

**Cause:** Provider not initialized

**Fix:**
```tsx
// Check console for analytics object:
console.log(window.analytics); // Should exist

// If undefined, check provider initialization in layout.tsx
```

---

## 🎯 Testing Checklist

Before deploying:

- [ ] First-time user flow works (Story → Onboarding → Voting)
- [ ] Returning user auto-redirects to /dashboard
- [ ] Bottom navigation works on all pages
- [ ] Onboarding "Skip" button works
- [ ] Onboarding "Let's Go!" navigates to /dashboard
- [ ] All 4 nav tabs navigate correctly
- [ ] Analytics events fire (check console logs)
- [ ] Mobile responsive (test on real device)
- [ ] Swipe gestures work in Voting Arena
- [ ] Vote button works (check API calls)
- [ ] Progress sphere updates after voting
- [ ] localStorage persists across refreshes

---

## 📈 Performance Optimization

### 1. Code Splitting

```tsx
// In app/page.tsx, lazy load Story Page:
import dynamic from 'next/dynamic';

const StoryPageWithOnboarding = dynamic(
  () => import('./story/page'),
  { ssr: false }
);
```

### 2. Image Optimization

```tsx
// Use Next.js Image component:
import Image from 'next/image';

<Image
  src={clip.thumbnail}
  alt="Clip thumbnail"
  width={400}
  height={711}
  priority={index < 3}
/>
```

### 3. Prefetch Routes

```tsx
// In BottomNavigation, prefetch on hover:
<Link
  href={item.path}
  prefetch={true} // Prefetch on mount
  onMouseEnter={() => router.prefetch(item.path)}
>
```

---

## 🔒 Security Best Practices

### 1. Rate Limiting

Add rate limiting to prevent abuse:

```tsx
// In dashboard page, add throttle:
import { throttle } from 'lodash';

const handleVoteThrottled = throttle(handleVote, 1000);
```

### 2. Input Sanitization

```tsx
// Sanitize user inputs:
import DOMPurify from 'dompurify';

const sanitizedInput = DOMPurify.sanitize(userInput);
```

### 3. API Security

```tsx
// In API routes, add headers:
headers: {
  'Content-Security-Policy': "default-src 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
}
```

---

## 🚀 Production Deployment

### Vercel (Recommended)

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Login
vercel login

# 3. Deploy
vercel --prod

# 4. Set environment variables in Vercel dashboard:
# Settings → Environment Variables
```

### Environment Variables (Production):

```
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_ANALYTICS_PROVIDER
NEXT_PUBLIC_SEGMENT_WRITE_KEY (if using Segment)
NEXT_PUBLIC_POSTHOG_KEY (if using PostHog)
```

### CDN Configuration:

```json
// vercel.json
{
  "headers": [
    {
      "source": "/fonts/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

---

## 📚 Additional Resources

- [Framer Motion Docs](https://www.framer.com/motion/)
- [React Query Docs](https://tanstack.com/query/latest)
- [Supabase Docs](https://supabase.com/docs)
- [Segment Analytics](https://segment.com/docs/)
- [PostHog Analytics](https://posthog.com/docs)

---

## 🆘 Need Help?

1. Check console for errors: `F12 → Console`
2. Inspect localStorage: `F12 → Application → Local Storage`
3. Check network requests: `F12 → Network`
4. Review analytics calls: `F12 → Console` (analytics logs)

---

## 🎉 You're Done!

Your hybrid routing system is ready! 🚀

**What you have:**
- ✅ Smart routing (first-time vs returning)
- ✅ Onboarding flow (3 screens)
- ✅ Bottom navigation (4 tabs)
- ✅ Analytics tracking (all events)
- ✅ Mobile-optimized
- ✅ Production-ready

**Next steps:**
1. Customize colors/branding
2. Add real video content
3. Connect analytics provider
4. Deploy to production
5. Monitor metrics
6. Iterate based on data

---

Made with ❤️ for AiMoviez · 8SEC MADNESS

*"First-time users get context. Returning users get action. Everyone wins."* ✨
