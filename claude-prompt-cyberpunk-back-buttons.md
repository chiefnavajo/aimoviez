# Prompt for Claude: Add Cyberpunk Back Buttons

## Task
Add cyberpunk-styled back header buttons with ArrowLeft icon to the watch, upload, and leaderboard pages. The buttons should have neon cyan/purple colors, glow effects, and glass morphism styling.

## Files to Modify

### 1. `src/app/watch/page.tsx`
- **Current**: Has a back button with X icon at line 380-385, but it's only visible when video controls overlay is shown (auto-hides after 3 seconds)
- **Action**: 
  - Import `ArrowLeft` from `lucide-react` (add to existing import statement on line 8-10)
  - ADD a new persistent back button matching profile page style
  - Position it at `absolute top-4 left-4 z-20` (top-left corner, OUTSIDE the conditional overlay controls)
  - Place it BEFORE the video player section (around line 356, right after the opening div)
  - This button will be ALWAYS visible (unlike the X button which only shows with controls)
  - Keep the existing X button unchanged in the overlay controls (it can stay for when controls are visible)

### 2. `src/app/upload/page.tsx`
- **Current**: No back button on mobile layout
- **Action**:
  - Import `ArrowLeft` from `lucide-react` (add to existing import on line 7)
  - `useRouter` is already imported on line 4
  - Add the back button matching profile page style in the mobile layout section (around line 494, inside the `md:hidden` div, at the very top before any content)

### 3. `src/app/leaderboard/page.tsx`
- **Current**: No back button on mobile layout
- **Action**:
  - Import `ArrowLeft` from `lucide-react` (add to existing import on line 25)
  - Import `useRouter` from `next/navigation` (add import if not present)
  - Add the back button matching profile page style in the mobile layout section (around line 337, inside the `md:hidden` div, at the very top before the header)

## Enhanced Cyberpunk Back Button Styling

Use this exact implementation for all three pages - enhanced cyberpunk style with neon gradients, intense glow effects, and animated borders:

```tsx
<motion.button
  whileTap={{ scale: 0.9 }}
  whileHover={{ scale: 1.05 }}
  onClick={() => router.back()}
  className="absolute top-4 left-4 z-20 p-[2px] rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 shadow-[0_0_20px_rgba(59,130,246,0.6),0_0_40px_rgba(147,51,234,0.4)] hover:shadow-[0_0_30px_rgba(59,130,246,0.8),0_0_60px_rgba(147,51,234,0.6)] transition-all duration-300"
>
  <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-cyan-400/30">
    <ArrowLeft className="w-5 h-5 text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,1)]" />
  </div>
</motion.button>
```

**Alternative Option - More Angular Cyberpunk Style:**

```tsx
<motion.button
  whileTap={{ scale: 0.9 }}
  whileHover={{ scale: 1.05 }}
  onClick={() => router.back()}
  className="absolute top-4 left-4 z-20 p-[2px] rounded-lg bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-600 shadow-[0_0_20px_rgba(6,182,212,0.6),0_0_40px_rgba(168,85,247,0.4)] hover:shadow-[0_0_30px_rgba(6,182,212,0.9),0_0_60px_rgba(168,85,247,0.6)] transition-all duration-300"
>
  <div className="w-10 h-10 rounded-lg bg-black/70 backdrop-blur-md flex items-center justify-center border border-cyan-400/40">
    <ArrowLeft className="w-5 h-5 text-cyan-300 drop-shadow-[0_0_12px_rgba(34,211,238,1)]" />
  </div>
</motion.button>
```

## Key Requirements

1. **Position**: `absolute top-4 left-4 z-20` - positioned at top-left corner

2. **Enhanced Cyberpunk Styling**: 
   - **Gradient Border**: `p-[2px]` wrapper with `bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500` for animated neon edge
   - **Multi-layer Glow**: Double shadow for depth: `shadow-[0_0_20px_rgba(59,130,246,0.6),0_0_40px_rgba(147,51,234,0.4)]`
   - **Inner Container**: Glass morphism `bg-black/60 backdrop-blur-md` with subtle inner border
   - **Enhanced Hover**: Intensified multi-layer glow on hover
   - **Shape**: Choose between `rounded-full` (circular) or `rounded-lg` (angular, more cyberpunk)
   - **Size**: `w-10 h-10` inner size

3. **Icon Styling**: 
   - ArrowLeft with `w-5 h-5 text-cyan-400` or `text-cyan-300`
   - Strong glow: `drop-shadow-[0_0_10px_rgba(34,211,238,1)]` or `drop-shadow-[0_0_12px_rgba(34,211,238,1)]`

4. **Animations**: 
   - `whileTap={{ scale: 0.9 }}` - shrink on tap
   - `whileHover={{ scale: 1.05 }}` - grow on hover
   - `transition-all duration-300` - smooth transitions

5. **Functionality**: `onClick={() => router.back()}` to navigate back

6. **Style Choice**: 
   - Use the first option for circular shape with intense glow
   - Use the alternative for angular (`rounded-lg`) for more cyberpunk aesthetic

## Notes

- Make sure `motion` is imported from `framer-motion` (should already be present in all files)
- Make sure `router` is initialized with `const router = useRouter()` in each component (check if already present)
- **IMPORTANT**: For watch page - The X button is inside conditional overlay controls (only visible when `showControls` is true). ADD a new persistent back button at the top-left corner that's ALWAYS visible (outside the conditional overlay area, at the root level of the component)
- For upload and leaderboard: Add the button at the very top of the mobile layout (`md:hidden` div), before any other content
- Ensure proper z-index (`z-20` or higher) so the button appears above video and other content
- This uses cyberpunk styling with neon cyan colors, glow effects, and enhanced hover states
- The watch page will have the new ArrowLeft button (always visible) AND the existing X button (only visible when controls overlay is shown)

## Expected Result

All three pages will have a consistent enhanced cyberpunk-styled back button:

**Visual Features:**
- Gradient border wrapper creating animated neon edge (cyan → blue → purple)
- Multi-layer glow effects for depth (cyan and purple shadows)
- Glass morphism inner background (`bg-black/60 backdrop-blur-md`)
- Intense cyan glow on ArrowLeft icon
- Enhanced glow effects on hover (stronger and wider shadows)
- Smooth tap animation (scale 0.9) and hover animation (scale 1.05)
- Choice between circular (`rounded-full`) or angular (`rounded-lg`) shape

**Page Implementation:**
- **Watch page**: New ArrowLeft button (always visible at top-left) AND existing X button (only visible when controls overlay shows)
- **Upload and Leaderboard pages**: New ArrowLeft button at top-left

**Cyberpunk Aesthetic:**
- Neon gradient borders (cyan/blue/purple)
- Multi-layer glowing shadows
- Strong icon glow effects
- Smooth transitions and animations
- Glass morphism with dark background

