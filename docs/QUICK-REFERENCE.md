# 🎯 HYBRID ROUTING - Quick Reference Card

## 📁 File Structure

```
app/
├── page.tsx                    → Smart router (first vs returning)
├── layout.tsx                  → QueryClient + Analytics
├── story/page.tsx              → Story Page + Onboarding
├── dashboard/page.tsx          → Voting Arena
├── upload/page.tsx             → Upload (placeholder)
└── profile/page.tsx            → Profile (placeholder)

components/
├── OnboardingOverlay.tsx       → 3-screen tutorial
└── BottomNavigation.tsx        → Tab navigation

lib/
└── analytics.ts                → Event tracking
```

---

## ⚡ 3-Minute Setup

```bash
# 1. Copy files
cp app-page.tsx app/page.tsx
cp layout.tsx app/layout.tsx
cp BottomNavigation.tsx components/BottomNavigation.tsx
cp OnboardingOverlay.tsx components/OnboardingOverlay.tsx
cp story-page-integrated.tsx app/story/page.tsx
cp dashboard-page-integrated.tsx app/dashboard/page.tsx
cp lib-analytics.ts lib/analytics.ts

# 2. Install deps
npm install @tanstack/react-query framer-motion lucide-react

# 3. Test
npm run dev
```

---

## 🔄 User Flow

```
First Visit:
  / → Story Page → Onboarding → /dashboard
  (marks: has_visited_before = true)

Second Visit:
  / → Auto-redirect → /dashboard

Always:
  Bottom Nav: [Story] [Shorts] [Upload] [Profile]
```

---

## 🎨 Key Components

### Smart Router (`app/page.tsx`)
```tsx
if (hasVisitedBefore) {
  router.replace('/dashboard'); // Returning user
} else {
  <StoryPage />; // First-time user
}
```

### Onboarding Completion
```tsx
const handleOnboardingComplete = () => {
  localStorage.setItem('has_visited_before', 'true');
  router.push('/dashboard');
};
```

### Bottom Navigation
```tsx
<BottomNavigation />
// Always rendered at bottom of every page
// Automatically highlights active tab
```

---

## 📊 Analytics Events

### Auto-tracked:
- `App Opened` (first vs returning)
- `Page View` (route changes)
- `Navigation Tab Changed`

### Manual (integrated):
- `Onboarding Completed/Skipped`
- `Vote Cast`
- `Clip Swiped`
- `CTA Clicked`

### Usage:
```tsx
import { trackVoteCast } from '@/lib/analytics';

trackVoteCast(clipId, 'standard', votesToday);
```

---

## 🐛 Quick Debug

### Onboarding shows every time?
```tsx
// Check localStorage:
localStorage.getItem('onboarding_completed') // Should be 'true'

// Force reset:
localStorage.clear()
```

### Not redirecting?
```tsx
// Check both flags:
console.log({
  visited: localStorage.getItem('has_visited_before'),
  onboarding: localStorage.getItem('onboarding_completed')
});
```

### Analytics not working?
```tsx
// Check console (development mode):
// Should see: "📊 Analytics: Event Name { properties }"

// In production, check provider:
console.log(window.analytics); // Segment
console.log(window.posthog);   // PostHog
console.log(window.mixpanel);  // Mixpanel
```

---

## 🎯 Customization

### Change default landing:
```tsx
// app/page.tsx
router.replace('/dashboard'); // Current
router.replace('/story');     // Change to Story
```

### Add nav item:
```tsx
// BottomNavigation.tsx
{
  id: 'discover',
  label: 'Discover',
  icon: Search,
  path: '/discover',
  color: 'from-blue-500 to-cyan-500',
}
```

### Disable onboarding:
```tsx
// story/page.tsx
const { showOnboarding } = useOnboarding();
// Remove <OnboardingOverlay /> component
```

---

## 🚀 Deploy Checklist

- [ ] Set env vars in Vercel
- [ ] Test on real mobile device
- [ ] Verify analytics tracking
- [ ] Check localStorage persistence
- [ ] Test all navigation tabs
- [ ] Verify onboarding flow
- [ ] Test voting functionality

---

## 📱 Mobile Testing

```bash
# Test on real device:
# 1. Get local IP: ifconfig | grep inet
# 2. Run: npm run dev
# 3. Open on phone: http://192.168.x.x:3000

# Clear storage on mobile:
# Chrome: Settings → Site Settings → Clear Storage
# Safari: Settings → Safari → Clear History
```

---

## 🎨 Brand Colors

```tsx
// Primary Gradient
from-cyan-500 via-purple-500 to-pink-500

// Slot States
Locked:   from-emerald-500 to-teal-500
Voting:   from-orange-500 to-pink-500
Upcoming: from-slate-500 to-zinc-500

// Nav Active
Story:   from-cyan-500 to-purple-500
Shorts:  from-orange-500 to-pink-500
Upload:  from-purple-500 to-pink-500
Profile: from-pink-500 to-rose-500
```

---

## 💾 LocalStorage Keys

```
onboarding_completed     → 'true' after onboarding
has_visited_before       → 'true' after first session
voter_key                → 'voter_[timestamp]_[random]'
```

---

## ⚙️ Config

### tsconfig.json
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  }
}
```

### .env.local
```env
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_ANALYTICS_PROVIDER=console
```

---

## 🎁 Bonus Scripts

### Reset onboarding (dev):
```javascript
// Run in console:
localStorage.removeItem('onboarding_completed');
localStorage.removeItem('has_visited_before');
location.reload();
```

### Check user state:
```javascript
console.table({
  'Voter Key': localStorage.getItem('voter_key'),
  'Onboarding Done': localStorage.getItem('onboarding_completed'),
  'Has Visited': localStorage.getItem('has_visited_before'),
  'Route': window.location.pathname
});
```

### Force user type:
```javascript
// Force first-time:
localStorage.clear();

// Force returning:
localStorage.setItem('has_visited_before', 'true');
localStorage.setItem('onboarding_completed', 'true');
```

---

## 📞 Support

**Check logs:**
```bash
# Development
npm run dev
# Check terminal + browser console

# Production
# Vercel: vercel logs
```

**Common issues:**
1. Infinite redirect → Check routing guards
2. No analytics → Check provider init
3. Onboarding loops → Check localStorage
4. Nav not working → Check import paths

---

## 🎉 Done!

System is ready to ship! 🚀

Quick links:
- Full guide: `HYBRID-ROUTING-GUIDE.md`
- Analytics: `lib/analytics.ts`
- Components: `components/`

---

**Remember:**
- First-time → Story + Onboarding
- Returning → Direct to Voting Arena
- Always → Bottom Nav accessible

**That's it!** 💫
