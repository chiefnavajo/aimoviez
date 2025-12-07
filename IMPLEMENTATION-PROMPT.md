# Implementation Task: Add Cyberpunk Back Buttons

## Objective
Add cyberpunk-styled back navigation buttons with ArrowLeft icon to three pages: watch, upload, and leaderboard. These buttons will allow users to navigate back to the previous screen with a consistent, visually striking design that matches the app's cyberpunk aesthetic.

## Visual Design
The button features:
- **Gradient Border**: Animated neon edge with cyan → blue → purple gradient
- **Multi-layer Glow**: Dual shadow layers (cyan and purple) for depth
- **Glass Morphism**: Semi-transparent dark background with blur effect
- **Neon Icon**: Cyan ArrowLeft icon with intense glow drop-shadow
- **Hover Effects**: Enhanced glow and scale animation on hover
- **Tap Animation**: Shrink effect on tap for tactile feedback

## Technical Stack
- **Framework**: Next.js (React)
- **Animation**: Framer Motion (`motion` components)
- **Icons**: Lucide React
- **Styling**: Tailwind CSS with custom shadow utilities
- **Navigation**: Next.js `useRouter` hook

## Implementation Details

### 1. Watch Page (`src/app/watch/page.tsx`)

**Context**: The watch page is a full-screen video player. It currently has an X button that only appears when the video controls overlay is visible (auto-hides after 3 seconds). We need to add a persistent back button that's always visible at the top-left corner.

**Step 1: Update Imports**

Add `ArrowLeft` to the lucide-react imports (around line 7-10).

**FIND THIS:**
```typescript
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Maximize, Share2, List, X, Loader2
} from 'lucide-react';
```

**CHANGE TO:**
```typescript
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Maximize, Share2, List, X, Loader2, ArrowLeft
} from 'lucide-react';
```

**Step 2: Add the Back Button**

Add the cyberpunk back button immediately after the component's opening `<div>` tag (around line 356), BEFORE the video player section. This ensures it's always visible and positioned at the top-left corner, independent of the video controls overlay.

**FIND THIS (around line 355-358):**
```tsx
return (
  <div className="relative min-h-screen min-h-[100dvh] w-full bg-black overflow-hidden">
    {/* Video Player */}
    <div className="absolute inset-0 flex items-center justify-center">
```

**CHANGE TO:**
```tsx
<div className="relative min-h-screen min-h-[100dvh] w-full bg-black overflow-hidden">
  {/* Cyberpunk Back Button - Always Visible */}
  <motion.button
    whileTap={{ scale: 0.9 }}
    whileHover={{ scale: 1.05 }}
    onClick={() => router.back()}
    className="absolute top-4 left-4 z-30 p-[2px] rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 shadow-[0_0_20px_rgba(59,130,246,0.6),0_0_40px_rgba(147,51,234,0.4)] hover:shadow-[0_0_30px_rgba(59,130,246,0.8),0_0_60px_rgba(147,51,234,0.6)] transition-all duration-300"
  >
    <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-cyan-400/30">
      <ArrowLeft className="w-5 h-5 text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,1)]" />
    </div>
  </motion.button>
  
  {/* Video Player */}
  <div className="absolute inset-0 flex items-center justify-center">
```

---

**Why this placement?**
- `z-30` ensures it appears above the video (z-index 0) and overlay controls
- `absolute top-4 left-4` positions it at the top-left corner with proper spacing
- Placed outside the conditional overlay so it's always visible
- The existing X button (line 380-385) remains unchanged in the overlay controls

---

### 2. Upload Page (`src/app/upload/page.tsx`)

**Context**: The upload page allows users to upload video clips. It currently has no back button on mobile layouts, forcing users to use browser navigation or bottom navigation. We'll add a consistent back button at the top-left.

**Step 1: Update Imports**

Add `ArrowLeft` to the lucide-react imports (line 7).

**FIND THIS:**
```typescript
import { Upload, Check, Loader2, AlertCircle, BookOpen, User, Volume2, VolumeX, Plus, Heart, Trophy, LogIn } from 'lucide-react';
```

**CHANGE TO:**
```typescript
import { Upload, Check, Loader2, AlertCircle, BookOpen, User, Volume2, VolumeX, Plus, Heart, Trophy, LogIn, ArrowLeft } from 'lucide-react';
```

**Note**: `useRouter` is already imported on line 4, so no need to add it.

**Step 2: Add the Back Button**

Add the cyberpunk back button at the very top of the mobile layout section (around line 494), inside the `md:hidden` div, before `{renderUploadContent()}`.

**FIND THIS (around line 493-497):**
```tsx
{/* Mobile Layout */}
<div className="md:hidden pb-20">
  {renderUploadContent()}
  <BottomNavigation />
</div>
```

**CHANGE TO:**
```tsx
{/* Mobile Layout */}
<div className="md:hidden pb-20">
  {/* Cyberpunk Back Button */}
  <motion.button
    whileTap={{ scale: 0.9 }}
    whileHover={{ scale: 1.05 }}
    onClick={() => router.back()}
    className="absolute top-4 left-4 z-30 p-[2px] rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 shadow-[0_0_20px_rgba(59,130,246,0.6),0_0_40px_rgba(147,51,234,0.4)] hover:shadow-[0_0_30px_rgba(59,130,246,0.8),0_0_60px_rgba(147,51,234,0.6)] transition-all duration-300"
  >
    <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-cyan-400/30">
      <ArrowLeft className="w-5 h-5 text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,1)]" />
    </div>
  </motion.button>
  
  {renderUploadContent()}
  <BottomNavigation />
</div>
```

---

**Why this placement?**
- Inside `md:hidden` div means it only appears on mobile/tablet viewports
- `absolute top-4 left-4` positions it at the top-left corner
- `z-30` ensures it appears above upload content and overlays
- Placed before `{renderUploadContent()}` so it's rendered first and always accessible

---

### 3. Leaderboard Page (`src/app/leaderboard/page.tsx`)

**Context**: The leaderboard page displays top clips, voters, and creators. It currently has no back button on mobile layouts. We'll add a consistent back button and ensure the `useRouter` hook is properly set up.

**Step 1: Add Router Import**

Check if `useRouter` is imported. If not, add it at the top (around line 5).

**FIND THIS (around line 1-10):**
```typescript
'use client';

// ... existing imports ...
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
```

**ADD THIS (if not already present):**
```typescript
import { useRouter } from 'next/navigation';
```

**Step 2: Update Icon Imports**

Add `ArrowLeft` to the lucide-react imports (around line 11-25).

**FIND THIS:**
```typescript
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  Crown,
  Heart,
  BookOpen,
  Plus,
  User,
  Medal,
  Users,
  Film,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react';
```

**CHANGE TO:**
```typescript
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  Crown,
  Heart,
  BookOpen,
  Plus,
  User,
  Medal,
  Users,
  Film,
  ChevronRight,
  ArrowLeft,  // ADD THIS
} from 'lucide-react';
```

**Step 3: Initialize Router Hook**

Initialize the router in the `LeaderboardPageContent` component (around line 75-76).

**FIND THIS:**
```typescript
function LeaderboardPageContent() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('clips');
```

**CHANGE TO:**
```typescript
function LeaderboardPageContent() {
  const router = useRouter();  // ADD THIS LINE
  const [activeTab, setActiveTab] = useState<TabType>('clips');
```

**Step 4: Add the Back Button**

Add the cyberpunk back button at the top of the mobile layout section (around line 337), inside the `md:hidden` div, before the header section.

**FIND THIS (around line 337-350):**
```tsx
{/* Mobile Layout */}
<div className="md:hidden pb-20">
  {/* Header */}
  <div className="px-4 pt-12 pb-4">
    <h1 className="text-2xl font-black flex items-center gap-2">
```

**CHANGE TO:**
```tsx
{/* Mobile Layout */}
<div className="md:hidden pb-20">
  {/* Cyberpunk Back Button */}
  <motion.button
    whileTap={{ scale: 0.9 }}
    whileHover={{ scale: 1.05 }}
    onClick={() => router.back()}
    className="absolute top-4 left-4 z-30 p-[2px] rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 shadow-[0_0_20px_rgba(59,130,246,0.6),0_0_40px_rgba(147,51,234,0.4)] hover:shadow-[0_0_30px_rgba(59,130,246,0.8),0_0_60px_rgba(147,51,234,0.6)] transition-all duration-300"
  >
    <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-cyan-400/30">
      <ArrowLeft className="w-5 h-5 text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,1)]" />
    </div>
  </motion.button>
  
  {/* Header */}
  <div className="px-4 pt-12 pb-4">
```

---

**Why this placement?**
- Inside `md:hidden` div means it only appears on mobile/tablet viewports
- `absolute top-4 left-4` positions it at the top-left corner
- `z-30` ensures it appears above leaderboard content
- Placed before the header so it's rendered first and always accessible
- `pt-12` on the header provides space for the button

---

## Styling Breakdown

Let me explain each CSS class used in the button:

### Outer Button (motion.button)
- `absolute top-4 left-4 z-30` - Position at top-left, high z-index
- `p-[2px]` - 2px padding creates space for gradient border
- `rounded-full` - Circular shape
- `bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500` - Neon gradient border
- `shadow-[0_0_20px_rgba(59,130,246,0.6),0_0_40px_rgba(147,51,234,0.4)]` - Multi-layer glow (cyan + purple)
- `hover:shadow-[0_0_30px_rgba(59,130,246,0.8),0_0_60px_rgba(147,51,234,0.6)]` - Intensified glow on hover
- `transition-all duration-300` - Smooth transitions

### Inner Container (div)
- `w-10 h-10` - 40px × 40px size
- `rounded-full` - Circular shape (matches outer)
- `bg-black/60` - 60% opacity black background
- `backdrop-blur-md` - Glass morphism blur effect
- `flex items-center justify-center` - Center the icon
- `border border-cyan-400/30` - Subtle inner cyan border (30% opacity)

### Icon (ArrowLeft)
- `w-5 h-5` - 20px × 20px icon size
- `text-cyan-400` - Cyan color
- `drop-shadow-[0_0_10px_rgba(34,211,238,1)]` - Intense cyan glow effect

### Animations (Framer Motion)
- `whileTap={{ scale: 0.9 }}` - Shrink to 90% when pressed
- `whileHover={{ scale: 1.05 }}` - Grow to 105% on hover

---

## Verification Checklist

After implementation, verify each of the following:
- [ ] All three pages have the cyberpunk back button at top-left
- [ ] Buttons have neon gradient border (cyan → blue → purple)
- [ ] Buttons have multi-layer glow effects
- [ ] Hover state intensifies the glow
- [ ] Tap animation scales down (0.9)
- [ ] `router.back()` navigates to previous page
- [ ] Button appears above other content (z-30)
- [ ] `motion` from framer-motion is imported in all files
- [ ] ArrowLeft icon is imported from lucide-react in all files

---

## Testing Instructions

After implementation, test each page:

### Watch Page Testing
1. Navigate to `/watch`
2. Verify back button appears at top-left immediately
3. Check that button remains visible when video controls hide
4. Test tap animation (button should shrink)
5. Test hover animation on desktop (button should grow and glow more)
6. Click button to verify navigation back works
7. Verify the X button in overlay controls still works independently

### Upload Page Testing
1. Navigate to `/upload`
2. Verify back button appears at top-left on mobile viewport
3. Test that button doesn't appear on desktop (md: and above)
4. Test tap and hover animations
5. Click button to verify navigation back works
6. Ensure button appears above upload content

### Leaderboard Page Testing
1. Navigate to `/leaderboard`
2. Verify back button appears at top-left on mobile viewport
3. Test that button doesn't appear on desktop (md: and above)
4. Test tap and hover animations
5. Click button to verify navigation back works
6. Ensure button appears above leaderboard content and tabs

---

## Troubleshooting

### Issue: Button not showing
- Check z-index (should be z-30)
- Verify `absolute` positioning
- Check if parent has `relative` positioning
- Verify imports are correct

### Issue: Animations not working
- Verify `motion` is imported from `framer-motion`
- Check that it's `motion.button`, not regular `button`
- Ensure Framer Motion is installed: `npm list framer-motion`

### Issue: Navigation not working
- Verify `useRouter` is imported from `next/navigation`
- Check that `router` is initialized: `const router = useRouter()`
- Verify the component is a client component (`'use client'` at top)

### Issue: Glow effects not showing
- Check browser support for custom shadows
- Verify the shadow values in className are correct
- Test in different browsers (Chrome, Firefox, Safari)

### Issue: Button appears on desktop when it shouldn't (upload/leaderboard)
- Verify button is inside `md:hidden` div
- Check Tailwind configuration for breakpoints

---

## Additional Notes

- **Consistency**: All three buttons use identical styling for a unified experience
- **z-index**: Set to z-30 to ensure visibility above all content
- **Watch page special case**: Has two back buttons (persistent ArrowLeft + conditional X)
- **Navigation method**: Uses `router.back()` from Next.js router
- **Responsive**: Only visible on mobile for upload and leaderboard; always visible on watch page
- **Performance**: Uses CSS transforms for animations (GPU-accelerated)
- **Accessibility**: Button has proper click targets (40px × 40px minimum)

---

## Expected Visual Result

When complete, you should see:
- A circular button with a glowing neon border (cyan to purple gradient)
- The border has a visible glow effect (cyan and purple halos)
- Inside is a semi-transparent dark circle with a cyan arrow
- The arrow has its own glow effect
- On hover: The glow intensifies and the button grows slightly
- On tap: The button shrinks briefly
- The button is always in the top-left corner at the same position across all three pages

