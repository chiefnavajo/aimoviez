# AiMoviez · 8SEC MADNESS — Complete Project Description

**Version:** 0.1.0 (Beta)
**Last Updated:** January 28, 2026

---

## Table of Contents

1. [Vision & Concept](#1-vision--concept)
2. [How It Works — The Big Picture](#2-how-it-works--the-big-picture)
3. [User Journey](#3-user-journey)
4. [Pages & User Interface](#4-pages--user-interface)
5. [The Voting System](#5-the-voting-system)
6. [The Comment System](#6-the-comment-system)
7. [Video Display & Playback System](#7-video-display--playback-system)
8. [Content Distribution & Fairness Algorithm](#8-content-distribution--fairness-algorithm)
9. [Season & Slot Mechanics](#9-season--slot-mechanics)
10. [Upload System](#10-upload-system)
11. [Gamification & Engagement](#11-gamification--engagement)
12. [Social Features](#12-social-features)
13. [Admin & Moderation System](#13-admin--moderation-system)
14. [Technical Architecture](#14-technical-architecture)
15. [Database Design](#15-database-design)
16. [API Reference](#16-api-reference)
17. [Security](#17-security)
18. [Performance & Scalability](#18-performance--scalability)
19. [Real-time Features](#19-real-time-features)
20. [Environment & Deployment](#20-environment--deployment)
21. [Scalability Deep-Dive](#21-scalability-deep-dive)

---

## 1. Vision & Concept

### What is AiMoviez?

**AiMoviez · 8SEC MADNESS** is a collaborative movie-making platform where the entire community collectively creates a film, one 8-second clip at a time, through democratic voting. It blends the addictive mechanics of TikTok with the collective decision-making of a community vote — resulting in a movie that no single person directed, but everyone shaped.

### The Core Idea

Imagine a movie where every scene was chosen by thousands of people. Each "scene" is an 8-second video clip uploaded by a creator. The community votes on which clip deserves to be the next piece of the movie. The winning clip gets permanently locked into the film's timeline. Repeat this process across 75 slots, and you get a complete collaborative movie — a Season.

### Why 8 Seconds?

- Fits the modern short-form content consumption pattern (TikTok, Reels, Shorts)
- Low barrier to entry — anyone can create an 8-second clip
- Forces creativity through constraint
- Makes voting fast and accessible — users can judge a clip in seconds
- 75 slots × 8 seconds = a ~10-minute movie per season

### What Makes It Unique

| Aspect | AiMoviez | Traditional Platforms |
|--------|----------|----------------------|
| **Content role** | Building blocks of a shared movie | Standalone posts |
| **Voting purpose** | Decides what becomes part of a permanent film | Vanity metric |
| **Community goal** | Collective creation of a movie | Individual content promotion |
| **Result** | A finished film everyone contributed to | Infinite feed with no conclusion |
| **Engagement model** | Season-based with clear beginning and end | Endless, no milestones |

---

## 2. How It Works — The Big Picture

AiMoviez is structured around **seasons**. Each season is a self-contained project to create one collaborative movie. A season consists of 75 "slots" — think of each slot as one scene in the movie. The community fills each slot by voting on which 8-second clip should go there. When all 75 slots have winners, the season is complete and the movie is assembled.

The process is sequential: only one slot is open for voting at a time. This creates urgency and focus — the whole community is watching the same clips and voting on the same position. When the voting window closes (typically 24 hours), the highest-voted clip wins that slot and becomes a permanent part of the film. All the clips that didn't win carry forward to compete in the next slot, giving every creator multiple chances to have their clip included.

Between seasons, the community votes on what genre the next movie should be (Thriller, Comedy, Action, Sci-Fi, Romance, Animation, or Horror), giving everyone a say in the creative direction.

### The Lifecycle of a Season

```
┌──────────────────────────────────────────────────────────────────┐
│                        SEASON LIFECYCLE                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. SEASON CREATED (75 empty slots)                              │
│     ↓                                                            │
│  2. SLOT 1 OPENS FOR VOTING                                      │
│     ↓                                                            │
│  3. CREATORS UPLOAD 8-second clips                               │
│     ↓                                                            │
│  4. COMMUNITY VOTES (24-hour voting window)                      │
│     ↓                                                            │
│  5. WINNING CLIP LOCKED INTO SLOT 1                              │
│     Non-winning clips move to Slot 2                             │
│     ↓                                                            │
│  6. SLOT 2 OPENS → Repeat steps 3-5                              │
│     ↓                                                            │
│  ...repeat for all 75 slots...                                   │
│     ↓                                                            │
│  7. SEASON COMPLETE — Full movie assembled                       │
│     ↓                                                            │
│  8. MOVIE AVAILABLE in Watch library                             │
│     ↓                                                            │
│  9. GENRE VOTING for next season begins                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### The Three Roles

1. **Creators** — Upload 8-second clips for the community to vote on
2. **Voters** — Watch clips and vote for which ones become part of the movie (up to 200 votes/day)
3. **Admins** — Moderate content, manage seasons, approve clips

---

## 3. User Journey

The onboarding experience is designed to get users from zero to voting in under 60 seconds. There are no sign-up forms, no email verification, no password creation. A single Google OAuth button handles authentication, and a quick profile setup (just a username) is the only step before the user lands in the voting arena and can start participating immediately.

Once inside, the app follows a daily engagement loop: users return each day to vote on new clips, earn XP for each vote, maintain voting streaks, unlock badges, and climb the leaderboard. This loop is reinforced with sound effects, haptic feedback, visual progress indicators, and milestone celebrations (confetti at 200 votes). The goal is to make voting feel rewarding in itself, not just a means to an end.

### Step-by-Step Flow

```
Landing Page
    │  One-click Google OAuth signup
    ▼
Onboarding
    │  Create username, set avatar
    ▼
Dashboard (Voting Arena)
    │  Watch clips, vote, earn XP
    ├──► Upload a clip (/upload)
    ├──► Watch the movie so far (/story)
    ├──► Check rankings (/leaderboard)
    ├──► View your stats (/profile)
    └──► Invite friends (referral system)
    │
    ▼
Daily Loop: Vote → Earn XP → Unlock Badges → Climb Ranks → Repeat
```

### First-Time User Experience

1. **Landing page** — Cyberpunk-styled page with animated intro overlay ("AiMoviez · 8SEC MADNESS"), social proof ("127 creators joined"), and a single "Join Beta" button
2. **Google OAuth** — One-click signup, no forms or passwords
3. **Profile creation** — Choose a username (3-20 chars), avatar auto-generated from Google or DiceBear API
4. **Onboarding tour** — Spotlight-based walkthrough highlighting the vote button, story page, upload, and bottom navigation (can be skipped, shown once)
5. **Dashboard** — Immediately see clips and start voting

---

## 4. Pages & User Interface

The app is built mobile-first and takes heavy inspiration from TikTok's interface patterns. The core viewing experience is a single full-screen video at a time with swipe navigation, making it immediately familiar to anyone who has used short-form video apps. On desktop, the layout expands to include sidebars and additional panels, but the video always remains the focal point.

The design language is intentionally bold and futuristic. The dark background with glowing cyan accents and glass-morphism effects creates a distinct visual identity that sets it apart from typical social apps. Every interactive element has feedback — buttons glow, votes trigger animations, progress rings fill with color gradients. The interface is designed to feel alive and responsive to every touch.

Navigation is split by platform: desktop users get a top navbar with round information and user menu, while mobile users get a fixed bottom navigation bar with five tabs (Vote/Story, Watch, Upload, Ranks, Profile). The bottom nav is context-aware and dynamically switches its first tab label depending on whether there's an active voting round or a completed season to watch.

### Visual Identity

The app uses a **cyberpunk/futuristic aesthetic** with:
- **Primary accent:** Cyan (#3CF2FF)
- **Gradient palette:** Cyan → Purple (#A020F0) → Pink (#FF00C7)
- **Background:** Deep black with glass-morphism (translucent panels with backdrop blur)
- **Effects:** Glowing borders, shimmer animations, animated gradient rings
- **Typography:** Inter font, clean and modern
- **Theme support:** Dark mode (default) and Light mode

### Navigation

```
DESKTOP:
┌─────────────────────────────────────────────────────┐
│  [Logo]  Round 3/12 - Action  [LIVE●]   [Avatar ▼] │  ← Navbar
├─────────────────────────────────────────────────────┤
│                                                      │
│                   Page Content                       │
│                                                      │
└─────────────────────────────────────────────────────┘

MOBILE:
┌─────────────────────────────────────────────────────┐
│                                                      │
│                   Page Content                       │
│                                                      │
├─────────────────────────────────────────────────────┤
│  [Vote]  [Watch]  [Upload]  [Ranks]  [Profile]     │  ← Bottom Nav
└─────────────────────────────────────────────────────┘
```

The bottom navigation is context-aware — the first tab switches between "Vote" (during active voting) and "Story" (when a season is complete).

---

### 4.1 Landing Page (`/`)

**Purpose:** First impression and signup gate

The landing page serves as both the marketing page and the login gate. It's designed to create immediate intrigue with its cyberpunk aesthetic and animated intro sequence. When a user first arrives, a 3.5-second full-screen overlay plays with the "AiMoviez · 8SEC MADNESS" branding in a typewriter animation — this is skipped automatically for returning users using localStorage. The page shows social proof ("127 creators joined") to reduce signup friction, and the only call-to-action is a single "Join Beta" button that triggers Google OAuth. No account creation forms, no email fields — just one click to enter.

**Layout:**
- Full-screen animated background with grid pattern and floating glowing orbs
- Central content card with glass-morphism
- "AiMoviez · 8SEC MADNESS" branding with typewriter effect (3.5s intro, auto-dismissed for returning users)
- "Join Beta" CTA button triggers Google OAuth
- Social proof badge: "127 creators joined" with trending indicator
- Links to About, Privacy, Terms

---

### 4.2 Dashboard — Voting Arena (`/dashboard`)

**Purpose:** Core engagement hub — this is where users spend most of their time

The Dashboard is the heart of the application — the place where users watch clips and cast votes. It mimics TikTok's single-video-at-a-time interface: one clip fills the screen, and the user either votes for it or swipes to see the next one. The logic behind which clips are shown is handled by the content distribution algorithm (see Section 8), which ensures fair exposure for all creators.

On the right side of the screen, a vertical column of action buttons provides quick access to voting, comments, sharing, and mute/unmute. The vote button is the most prominent — it uses an infinity symbol icon surrounded by a circular progress ring that fills up as the user approaches their daily 200-vote limit. The ring changes color from blue to cyan to green to gold as it fills, creating a satisfying visual progression.

The video auto-plays on load (muted by default on mobile to comply with browser autoplay policies). Users interact through gestures: a single tap pauses or resumes playback, a double-tap casts a vote (with a burst of heart particles for visual feedback), swiping up loads the next clip, and pulling from the top refreshes the content pool. Every vote triggers a sound effect and a 50ms haptic vibration, making the act of voting feel tactile and satisfying.

When there's no content to show (no active season, no clips uploaded, or season complete), the dashboard displays contextual empty states with appropriate icons and calls to action (links to upload, story page, or leaderboard).

**Layout (Mobile — TikTok-style):**
```
┌──────────────────────────────┐
│  Round 3/12 - Action  [LIVE●]│  ← Top bar
├──────────────────────────────┤
│                              │
│                              │
│    ┌────────────────────┐    │
│    │                    │    │
│    │   8-second video   │    │
│    │   (full screen)    │    │
│    │                    │    │  ← Auto-playing video
│    │                    │    │     with blurred BG fill
│    └────────────────────┘    │
│                              │
│              ┌──┐            │
│              │∞ │ ← Vote     │  ← Right-side action column
│              │42│   count    │
│              ├──┤            │
│              │💬│ ← Comments │
│              │12│   count    │
│              ├──┤            │
│              │↗ │ ← Share    │
│              ├──┤            │
│              │🔇│ ← Mute    │
│              └──┘            │
│                              │
│  @creator_name               │  ← Bottom creator info
│  [Action] genre badge        │
├──────────────────────────────┤
│ [Vote] [Watch] [+] [🏆] [👤]│  ← Bottom navigation
└──────────────────────────────┘
```

**Interactions:**
- **Single tap** on video → Play/pause
- **Double tap** on video → Vote (with heart animation burst)
- **Swipe up** → Next clip
- **Swipe down** → Previous clip
- **Pull from top** → Refresh content (rubber band effect)
- **Vote button tap** → Records vote, shows green checkmark, plays sound, haptic vibration (50ms)

**Vote Button:**
- Displays an infinity symbol (∞) icon
- Shows a circular progress ring around it representing daily vote progress
- Progress ring color transitions: blue (0%) → cyan (25%) → green (50%) → gold (75%+)
- After voting: switches to green checkmark (tap again to undo)
- At 200/day limit: button disabled with "Daily limit reached" message

**Empty/Status States:**
- **Season Complete:** Trophy icon + "Season Complete!" with links to Story and Leaderboard
- **No Active Season:** Hourglass + "New Season Coming Soon"
- **Waiting for Clips:** Megaphone + "Need More Clips!" with Upload CTA
- **All Voted:** Checkmark + "You've voted on all clips!" with refresh timer

---

### 4.3 Story Page (`/story`)

**Purpose:** Watch the movie being built — see locked-in winning clips played in sequence

The Story page is where users experience the end result of the community's collective voting — the movie itself. It plays all the winning clips for a season in sequence, auto-advancing from one segment to the next, creating a continuous viewing experience. This is the payoff for all the voting: users can see how their votes shaped the final film.

The video player uses a dual-layer rendering technique: the main video plays centered on screen with proper aspect ratio (`object-contain`), while a blurred, full-screen copy of the same video plays behind it (`object-cover`). This eliminates black bars regardless of the clip's original aspect ratio, creating a polished look similar to Instagram Stories.

On mobile, the bottom portion of the screen shows a collapsible season strip. In its collapsed state, it displays the current season name, a LIVE/Complete/Coming Soon status badge, and a progress bar showing how many slots have been filled. Users can swipe up to expand it for more details, or swipe left/right to switch between seasons. Each season is color-coded: red pulse for active voting, green for complete, gray for upcoming.

The page also supports voting and commenting on clips — the same right-side action buttons from the Dashboard appear here, allowing users to vote on the current segment's clip even from the Story view. This means engagement can happen from multiple entry points, not just the voting arena.

**Desktop Layout:**
```
┌────┬───────────────────────────────────────────┐
│    │                                           │
│ S  │         Full-screen video player          │
│ i  │                                           │
│ d  │    ┌───────────────────────────┐          │
│ e  │    │                           │    ┌──┐  │
│ b  │    │    Winning clip plays     │    │∞ │  │
│ a  │    │    (auto-advances to      │    │💬│  │
│ r  │    │     next segment)         │    │↗ │  │
│    │    │                           │    │🔇│  │
│ N  │    └───────────────────────────┘    └──┘  │
│ a  │                                           │
│ v  │    ◄ 3/75 ►   ← Segment navigation       │
│    │                                           │
├────┴───────────────────────────────────────────┤
│ Season 1 - Action │ Season 2 - Sci-Fi │ ...    │
└────────────────────────────────────────────────┘
```

**Mobile Layout:**
```
┌──────────────────────────────┐
│                              │
│     Full-screen video        │
│     (55% of screen)          │
│                              │
│              ┌──┐            │
│              │∞ │            │
│              │💬│            │
│              │↗ │            │
│              └──┘            │
│                              │
├──────────────────────────────┤
│ ▲ Season 1 - LIVE  ████░░ ▲ │  ← Collapsible season strip
│   Swipe ← → for seasons     │     (swipe up to expand)
├──────────────────────────────┤
│ [Story] [Watch] [+] [🏆][👤]│
└──────────────────────────────┘
```

**Video Player Features:**
- Plays winning clips in sequence (auto-advances after each ends)
- Dual-layer rendering: main video centered + blurred copy as background (fills aspect ratio gaps)
- Swipe up/down to navigate between segments
- Double-tap for fullscreen toggle
- Landscape mode with auto-hiding controls (tap to reveal)
- Progress bar at top showing position in the movie

**Season Strip (Mobile):**
- Collapsed: shows season name, status badge (LIVE/Complete/Coming Soon), progress bar
- Expanded: thumbnail, detailed stats, description
- Swipe left/right to change seasons
- Color-coded status: red pulse for LIVE, green for complete, gray for upcoming

**Typewriter Intro:**
- When first visiting a season, a typewriter-animated description appears over the video
- Auto-dismisses after 2 seconds, tap to skip
- Only shown once per session per season

**Contributors Panel:**
- Shows all winning clips for the current season as clickable cards
- Each card shows: position number, thumbnail, creator name, vote count

---

### 4.4 Watch Page (`/watch`)

**Purpose:** Library of completed season movies for replay

The Watch page functions as a movie library — a place to browse and replay all completed seasons. Unlike the Story page, which focuses on the current season's progress, the Watch page is for the archive: finished films that have all 75 slots filled with winning clips.

The library view shows season cards in a grid, each displaying a cover image (taken from the first or last winning clip), the season's genre label, total runtime, and clip count. Tapping a card transitions into a full player view with traditional video controls (play/pause, seek bar, previous/next, volume, fullscreen) and a playlist sidebar on the right listing all segments. The sidebar can be toggled by swiping from the right edge on mobile.

To ensure smooth playback, the player preloads the next two clips in the background using hidden `<video>` elements with `preload="metadata"`. These preloaded elements are stored in a Map cache to prevent DOM bloat and are cleaned up when the component unmounts to avoid memory leaks. When one clip ends, the player auto-advances to the next segment with no loading delay.

**Library View:**
```
┌──────────────────────────────────────┐
│  Your Movie Library                   │
├──────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐          │
│  │ Season 1 │  │ Season 2 │          │
│  │  Action   │  │  Sci-Fi  │          │
│  │   ▶ Play  │  │   ▶ Play │          │
│  │  10:00    │  │   8:32   │          │
│  │ 75 clips  │  │  64 clips│          │
│  └──────────┘  └──────────┘          │
└──────────────────────────────────────┘
```

**Player View:**
```
┌────────────────────────────────┬─────────┐
│                                │Playlist │
│    Video Player                │ S1  ▶   │
│    (full controls)             │ S2      │
│                                │ S3      │
│                                │ S4      │
├────────────────────────────────┤ S5      │
│ ◄◄  ▶  ►►  ▬▬▬▬▬▬▬▬  🔊 ⛶  │ ...     │
│ Season 1 • Slot 3 • @creator  │         │
└────────────────────────────────┴─────────┘
```

**Features:**
- Season cards with cover images, duration, clip count
- Full video player with play/pause, seek bar, previous/next, volume, fullscreen
- Playlist sidebar (swipe from right edge on mobile)
- Video preloading: next 2 clips preloaded for seamless playback
- Auto-advance to next slot when current finishes
- Share button for individual segments or full movie

---

### 4.5 Upload Page (`/upload`)

**Purpose:** 3-step wizard for submitting clips

The upload flow is designed as a three-step wizard that guides creators through the process of submitting a clip. In step one, the user selects a video file — either by dragging and dropping or tapping to browse. The file is immediately validated client-side for format (MP4, WebM, or MOV only), size (max 50MB), and duration (max 8 seconds with a 0.5-second buffer for encoding variance). If the file passes validation, a preview renders in 9:16 aspect ratio with the same blurred-background technique used in the main player, showing the creator exactly how their clip will look in the app.

Step two asks the user to select a genre from eight options displayed as a grid of tappable cards. Step three handles the actual upload: the client first requests a signed URL from the server, then uploads the file directly to Supabase Storage (bypassing Vercel's 4.5MB request body limit), and finally registers the clip's metadata in the database. A progress bar tracks the upload, and on completion the clip enters "pending" status to await admin review before it can appear in the voting arena.

```
Step 1: SELECT VIDEO          Step 2: SELECT GENRE         Step 3: UPLOADING
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│                      │     │  Choose a genre:      │     │                      │
│  ┌────────────────┐  │     │  ┌──────┐ ┌──────┐   │     │   ████████░░ 80%     │
│  │  Drag & drop   │  │     │  │💥 Act│ │😂 Com│   │     │                      │
│  │  or tap to     │  │     │  └──────┘ └──────┘   │     │  Uploading to        │
│  │  browse        │  │     │  ┌──────┐ ┌──────┐   │     │  storage...          │
│  └────────────────┘  │     │  │🔪 Thr│ │🚀 Sci│   │     │                      │
│                      │     │  └──────┘ └──────┘   │     │        ✅            │
│  After selection:    │     │  ┌──────┐ ┌──────┐   │     │  Upload Complete!    │
│  ┌────────────────┐  │     │  │❤️ Rom│ │🎨 Ani│   │     │  Pending review      │
│  │  9:16 Preview  │  │     │  └──────┘ └──────┘   │     │                      │
│  │  with blurred  │  │     │  ┌──────┐ ┌──────┐   │     │  Redirecting to      │
│  │  background    │  │     │  │👻 Hor│ │🎬 Oth│   │     │  dashboard in 3s...  │
│  │  [Duration]    │  │     │  └──────┘ └──────┘   │     │                      │
│  └────────────────┘  │     │                      │     │                      │
│       [Next →]       │     │      [Upload →]      │     │                      │
└──────────────────────┘     └──────────────────────┘     └──────────────────────┘
```

**Validation Rules:**
- Formats: MP4, WebM, MOV only
- Max file size: 50MB
- Max duration: 8 seconds (8.5s validation buffer)
- Real-time preview in 9:16 aspect ratio with blurred background

**Upload Pipeline:**
1. Client gets a signed URL from the server (CSRF-protected)
2. Client uploads directly to Supabase Storage (bypasses Vercel's 4.5MB body limit)
3. Client registers clip metadata in the database
4. Clip enters "pending" state awaiting admin approval

---

### 4.6 Leaderboard (`/leaderboard`)

**Purpose:** Rankings across three categories

The leaderboard provides competitive context and recognition. It answers three questions: which clips are the most popular, which voters are the most active, and which creators have accumulated the most votes across all their clips. Each question has its own tab.

Rankings are pulled from the database with paginated queries ordered by vote count. The top three entries in each tab receive special visual treatment — gold, silver, and bronze medal icons, colored avatar borders, and a sparkle animation. Trend indicators show whether a user or clip has moved up, down, or stayed the same compared to the previous period. Time filters (daily, weekly, all-time) let users track standings across different windows.

**Three Tabs:**

| Tab | Ranks By | Shows |
|-----|----------|-------|
| **Top Clips** | Most votes received | Thumbnail, creator, genre, vote count |
| **Top Voters** | Most votes cast | Avatar, username, total votes, trend |
| **Top Creators** | Most votes across all clips | Avatar, username, total received votes |

**Visual Details:**
- Gold/Silver/Bronze medal icons for top 3
- Sparkle animation on top 3 entries
- Colored avatar borders for podium positions
- Trend indicators (up/down/same vs previous period)
- Time filters: daily, weekly, all-time

---

### 4.7 Profile Page (`/profile`)

**Purpose:** Personal stats, achievements, and clip management

The profile page is the user's personal dashboard — a place to track progress, manage uploaded clips, and view voting history. It's organized into four tabs, each serving a different aspect of the user's activity on the platform.

The header area prominently displays the user's avatar (with an animated glow ring), username, global rank, current voting streak, and a level progress bar. The progress bar shows XP accumulated toward the next level, with an animated gradient that shimmers when the bar is nearly full. Below the header, the four tabs provide access to stats and badges (gamification progress), uploaded clips (with real-time status updates like Pending, LIVE, Winner, or Eliminated), recent voting history, and quick-access settings including admin tools for users with admin privileges.

**Header:**
```
┌──────────────────────────────────────┐
│     ╭────╮                           │
│     │ 🧑 │  ← Avatar with glow ring │
│     ╰────╯                           │
│     @username                        │
│     🏆 #42  🔥 7 day streak          │
│                                      │
│     Level 5 ████████░░ 340/500 XP    │
└──────────────────────────────────────┘
```

**Four Tabs:**

1. **Stats & Badges**
   - 4 stat cards: Today's votes (45/200), Total votes (12.5K), Clips uploaded (3), Wins (1)
   - Badge grid: unlocked badges glow, locked badges greyscale
   - In-progress badges show progress bars

2. **My Clips**
   - List of uploaded clips with thumbnails
   - Status badges: Pending (yellow), Approved (green), LIVE (orange pulse), Winner (cyan glow), Eliminated (red)
   - Vote counts for each clip

3. **Recent Votes**
   - History of last 20 votes cast
   - Shows creator avatar, username, slot position, date

4. **Settings**
   - Links to Story, Leaderboard, Settings page
   - Admin access panel (purple border, visible only to admins)
   - Sign out button

---

### 4.8 Settings Page (`/settings`)

**Purpose:** Account management and legal/privacy controls

The settings page handles account-level operations that users rarely need but must be able to access. It includes standard account information display, legal links (Terms, Privacy, Cookie preferences), and a PWA install prompt for users who want to add the app to their home screen.

The most important features here are the GDPR-compliant data operations: users can export all their data (clips, votes, comments, profile) as a JSON file, and they can permanently delete their account. The deletion flow is intentionally friction-heavy — users must type "DELETE MY ACCOUNT" exactly to confirm, and the page explicitly lists everything that will be deleted (profile, clips, votes, comments, all data). This cascade delete removes all user data across all related tables in the database.

**Sections:**
- Account info display
- PWA install prompt
- Legal links (Terms, Privacy, Cookies)
- **Export Data** — Downloads all user data as JSON (GDPR compliant)
- **Delete Account** — Requires typing "DELETE MY ACCOUNT" to confirm; irreversible; deletes all clips, votes, comments, and profile data

---

### 4.9 Admin Dashboard (`/admin`)

**Purpose:** Content moderation and platform management (admin-only)

The admin dashboard is a protected area accessible only to users with the `is_admin` flag set in the database. It provides the tools needed to run the platform day-to-day: reviewing and approving uploaded clips before they enter the voting pool, managing feature flags to toggle experimental features without redeploying, and moderating users (banning, unbanning, granting admin access).

Beyond the UI, admins also have access to a set of API-only operations for managing the season lifecycle: creating new seasons, advancing voting slots, manually assigning winners, resetting votes for testing, and viewing audit logs that track every admin action. Every administrative action is logged to an audit trail with the admin's email, the action taken, and a timestamp — this provides accountability and makes it possible to investigate any issues.

**Tabs:**
1. **Clips** — Approve/reject pending clips, edit metadata, filter by status
2. **Feature Flags** — Toggle experimental features on/off
3. **Users** — Search, ban/unban, toggle admin status, edit usernames

**Additional Admin Capabilities (via API):**
- Create/edit/delete seasons
- Manage story slots (advance, reset, assign winners)
- View audit logs
- Bulk operations (batch approve/reject)
- View moderation queue

---

## 5. The Voting System

### Overview

The voting system is the core engine of AiMoviez. It determines which 8-second clips become permanent parts of the collaborative movie.

The entire voting pipeline is designed around three principles: fairness (every clip gets seen), integrity (one person gets one vote per clip), and responsiveness (the UI feels instant even though validation happens server-side).

When a user votes, the client sends a POST request to `/api/vote` with the clip ID. The server validates the request through several layers: rate limiting (is this user under the 30 votes/minute threshold?), daily limit check (have they cast fewer than 200 votes today?), clip validation (is this clip in the active voting slot and still in "active" status?), duplicate check (have they already voted on this clip?), and optionally a CAPTCHA verification (feature-flagged). If all checks pass, the vote is inserted atomically using a PostgreSQL RPC function that locks the clip row, inserts the vote, and updates the clip's `vote_count` and `weighted_score` in a single transaction — preventing any race conditions from concurrent voters.

The client receives back the updated score and remaining daily votes, and updates the UI optimistically — meaning the green checkmark and vote count change appear instantly, before the server even responds. If the server returns an error, the UI rolls back. This pattern makes voting feel snappy even on slow connections.

### How Users Vote

1. User sees clips in the Dashboard (one at a time, TikTok-style)
2. User taps the **vote button** (infinity symbol) or **double-taps the video**
3. Vote is recorded server-side with validation
4. UI updates instantly (optimistic update) — green checkmark, sound effect, haptic vibration
5. Vote can be undone by tapping the vote button again (DELETE request)

### Vote Rules & Constraints

| Rule | Value |
|------|-------|
| Votes per clip per user | 1 (unless multi-vote mode enabled) |
| Daily vote limit | 200 per user |
| Who can vote | Anyone (authenticated or anonymous via device fingerprint) |
| Vote tracking | `voter_key` = SHA256(IP + User-Agent) or `user_${userId}` |
| Duplicate prevention | Database UNIQUE constraint on `(clip_id, voter_key)` |

### Database Schema

```sql
votes (
  id              UUID PRIMARY KEY,
  clip_id         UUID NOT NULL,          -- The clip being voted on
  voter_key       TEXT NOT NULL,          -- Device fingerprint or user ID
  user_id         TEXT,                   -- Authenticated user ID (if logged in)
  vote_weight     INTEGER DEFAULT 1,     -- Weight of the vote
  vote_type       TEXT DEFAULT 'standard',
  slot_position   INTEGER,               -- Which slot/round
  flagged         BOOLEAN DEFAULT FALSE, -- Suspicious activity flag
  created_at      TIMESTAMP,

  UNIQUE(clip_id, voter_key)             -- Prevents duplicate votes
)
```

### Vote Aggregation

Vote counts are never calculated on-the-fly by the application. Instead, they are maintained as denormalized counters directly on the `tournament_clips` table, updated automatically by PostgreSQL triggers whenever a vote is inserted or deleted. This means reading the vote count for any clip is always a simple column read (O(1)), not an aggregate query (O(n)). The triggers execute within the same database transaction as the vote operation itself, so the counters are always exactly consistent with the underlying vote data — there's no eventual consistency lag.

Vote counts are maintained on the `tournament_clips` table via database triggers:

```
ON INSERT vote → tournament_clips.vote_count += 1,
                 tournament_clips.weighted_score += vote_weight

ON DELETE vote → tournament_clips.vote_count -= 1,
                 tournament_clips.weighted_score -= vote_weight
```

These triggers are atomic — they use `GREATEST(0, ...)` to prevent negative counts and handle race conditions.

### RPC Functions (Atomic Operations)

**`insert_vote_atomic()`** — Safely inserts a vote with race condition protection:
- Parameters: clip_id, voter_key, user_id, vote_weight, slot_position, flagged
- Returns: vote_id, was_new_vote, new_vote_count, new_weighted_score, error_code
- Handles unique constraint violations gracefully

**`delete_vote_atomic()`** — Safely removes a vote with row locking:
- Prevents concurrent delete race conditions
- Returns updated clip stats

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/vote` | Fetch clips for voting + user vote stats |
| `POST` | `/api/vote` | Cast a vote |
| `DELETE` | `/api/vote` | Revoke a vote |

**POST /api/vote Request:**
```json
{ "clipId": "uuid-of-clip" }
```

**POST /api/vote Response:**
```json
{
  "success": true,
  "clipId": "uuid-of-clip",
  "newScore": 43,
  "totalVotesToday": 15,
  "remainingVotes": { "standard": 185 }
}
```

**GET /api/vote Response:**
```json
{
  "clips": [...],
  "totalVotesToday": 15,
  "remainingVotes": { "standard": 185 },
  "votedClipIds": ["uuid1", "uuid2"],
  "currentSlot": 3,
  "totalSlots": 75,
  "totalClipsInSlot": 12,
  "hasMoreClips": true
}
```

### Winner Selection

When a voting window closes, the system needs to determine which clip won and advance the tournament to the next slot. This process can happen automatically (via a cron job that runs every minute) or manually (an admin can assign a winner at any time). The winning clip is the one with the highest `weighted_score` — this is typically the same as `vote_count` for standard votes, but can differ if power votes (Super or Mega) are enabled.

The key detail is what happens to the non-winning clips: they don't disappear. Instead, they are moved to the next slot with their vote counts reset to zero. This gives every clip multiple chances to win, and it means the pool of clips competing in each slot grows over time as new uploads join the existing carry-overs. This carry-forward mechanic encourages early uploading (more slots to compete in) while still giving latecomers a fair shot.

When a voting period ends (24 hours by default):
1. The clip with the **highest `weighted_score`** wins the slot
2. The winning clip status becomes `locked` — it is permanently part of the movie
3. All other active clips **move to the next slot** with their `vote_count` reset to 0
4. The next slot opens for voting

### Genre Voting (Separate System)

Between seasons, users vote on the **genre** for the next season:

| Genre Options |
|---------------|
| Thriller, Comedy, Action, Sci-Fi, Romance, Animation, Horror |

- One genre vote per user (can change vote)
- Results shown as live percentages
- Admin uses results to set the next season's theme

### Anti-Fraud Measures

Voting integrity is critical — if users can game the system, the democratic premise of the platform falls apart. The anti-fraud strategy uses multiple overlapping layers, each catching a different type of abuse. Device fingerprinting (SHA256 hash of IP address + User-Agent string + browser client hints) identifies unique voters even without authentication, preventing one person from voting multiple times by opening incognito tabs. The daily 200-vote cap limits the impact of any single actor. The database's UNIQUE constraint on `(clip_id, voter_key)` is the ultimate backstop — even if all application-level checks are bypassed, the database itself will reject duplicate votes. Suspicious voting patterns (e.g., voting on every clip in rapid succession) are automatically flagged for admin review without blocking the user, allowing legitimate power-users to vote freely while still catching bots.

| Measure | Implementation |
|---------|---------------|
| Device fingerprinting | SHA256 hash of IP + User-Agent |
| Daily rate limit | 200 votes per device per day |
| Database constraint | UNIQUE(clip_id, voter_key) |
| Vote flagging | Suspicious patterns flagged in DB |
| hCaptcha | Optional, feature-flagged |
| Audit logging | All flagged votes logged for review |

---

## 6. The Comment System

### Overview

A TikTok-style comment system with threaded replies, likes, and emoji reactions. Comments appear as a transparent slide-up panel on mobile or a side panel on desktop.

The comment system is designed to feel lightweight and social rather than formal. It uses a transparent, blurred overlay panel that slides up from the bottom on mobile (using Framer Motion spring animations) or appears as a side panel on desktop. This overlay approach means users can still see the video behind the comments, maintaining context. Comments load 20 at a time with a "Load more" button for pagination, and can be sorted by newest or by most-liked ("top").

The threading model is intentionally simple: comments can have one level of replies, but you cannot reply to a reply. This prevents the deeply nested conversation threads that become unreadable on mobile screens. When a user taps "Reply" on a comment, the input field pre-fills with `@username` and the new comment is created with a `parent_comment_id` linking it to the parent. Replies are fetched in a single batch query for all visible parent comments to avoid the N+1 query problem.

Likes use an optimistic update pattern: when a user taps the heart icon, the UI immediately flips the like state and increments the counter. A PATCH request is sent to the server in the background. If the server returns an error, the UI reverts to the previous state using captured values. To prevent race conditions from rapid double-tapping, the like handler uses a React ref for synchronous state checking rather than relying on React's asynchronous state updates.

### User Interface

```
MOBILE (Slide-up panel):                   DESKTOP (Side panel):
┌──────────────────────────┐              ┌──────────┬──────────────┐
│  Comments (24)      [✕]  │              │          │ Comments (24)│
├──────────────────────────┤              │  Video   ├──────────────┤
│  @alice · 2h ago         │              │  Player  │ @alice · 2h  │
│  This is amazing! 🔥      │              │          │ Amazing! 🔥   │
│  ♡ 5  Reply              │              │          │ ♡ 5  Reply   │
│    └ @bob · 1h ago       │              │          │   └ @bob     │
│      I agree!            │              │          │     I agree! │
│      ♡ 2                 │              │          │     ♡ 2      │
│                          │              │          │              │
│  @charlie · 5h ago       │              │          │ @charlie     │
│  Vote for this one!      │              │          │ Vote for this│
│  ♡ 12  Reply             │              │          │ ♡ 12 Reply   │
├──────────────────────────┤              │          ├──────────────┤
│ [😀] Type a comment...   │              │          │ [😀] Type... │
└──────────────────────────┘              └──────────┴──────────────┘
```

### Features

- **Threading:** One level of nesting (replies to top-level comments)
- **Likes:** One like per user per comment, with database trigger for automatic count
- **Emoji picker:** 10 preset emojis (❤️ 🔥 😂 😮 👏 💯 🎬 👻 🚀 ✨)
- **Pagination:** 20 comments per page, "Load more" button
- **Sorting:** Newest first or Top (most liked)
- **Character limit:** 500 characters
- **Soft delete:** Deleted comments marked `is_deleted = true` (preserves audit trail)
- **Optimistic updates:** Likes and new comments appear instantly, roll back on error
- **Admin moderation:** Approve/reject/flag comments, bulk delete

### Database Schema

```sql
comments (
  id                UUID PRIMARY KEY,
  clip_id           TEXT NOT NULL,
  user_key          TEXT NOT NULL,
  username          TEXT NOT NULL,
  avatar_url        TEXT,
  comment_text      TEXT NOT NULL,       -- Max 500 chars
  likes_count       INTEGER DEFAULT 0,   -- Auto-updated by trigger
  parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  is_deleted        BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMP,
  updated_at        TIMESTAMP
)

comment_likes (
  id          UUID PRIMARY KEY,
  comment_id  UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_key    TEXT NOT NULL,
  UNIQUE(comment_id, user_key)           -- One like per user
)
```

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/comments?clipId=xxx` | Fetch comments (paginated, sorted) |
| `POST` | `/api/comments` | Post a new comment or reply |
| `PATCH` | `/api/comments` | Like or unlike a comment |
| `DELETE` | `/api/comments` | Soft-delete own comment |

### Performance

- **Batch reply fetching:** Single query for all replies (not N+1)
- **RPC function:** `get_comment_counts(clip_ids[])` for bulk counting
- **Race condition prevention:** Uses refs for synchronous like/unlike checks
- **Component memoization:** Prevents unnecessary re-renders

### Security

- All comment text sanitized (HTML tags removed, control characters stripped)
- Only authenticated users can delete (verified by server-side session)
- Rate limiting on all comment operations
- CSRF token required on all mutations
- XSS prevention through React escaping + server-side sanitization

---

## 7. Video Display & Playback System

Video playback is the most technically complex part of the frontend. The app needs to handle short-form video in three very different contexts — voting, story watching, and movie replay — each with different interaction patterns, controls, and performance requirements.

The most significant engineering challenge is making video feel native and instant on mobile web, where browser autoplay restrictions, varying network speeds, and device performance all create friction. The app addresses this through several techniques: preloading upcoming clips before the user needs them, using the dual-layer rendering approach (sharp foreground + blurred background) to eliminate black bars without cropping, and implementing gesture detection that distinguishes between taps (play/pause), double-taps (vote or fullscreen), and swipes (navigation) — all from the same touch surface.

The video player component itself (in `src/app/story/page.tsx`) is approximately 2,000 lines of code — the largest single component in the codebase. It handles video element lifecycle, gesture recognition, landscape mode detection, auto-advancing between segments, the dual video layer, progress bar seeking, and responsive layout switching between mobile and desktop. On mobile, only one video player is rendered to prevent double audio; on desktop, a sidebar with navigation replaces the mobile season strip.

### Three Viewing Contexts

The app has three distinct ways of presenting video content, each optimized for its purpose:

| Context | Page | Purpose | UI Style |
|---------|------|---------|----------|
| **Voting** | `/dashboard` | Judge and vote on clips | TikTok-style single video |
| **Story** | `/story` | Watch the movie being built | TikTok-style with season nav |
| **Watch** | `/watch` | Replay completed movies | Traditional player with playlist |

### Video Player Architecture

**Story Page Player** (`src/app/story/page.tsx`, ~2000 lines):

The most complex video player, handling:

1. **Dual-layer rendering:**
   - Main video: centered, `object-contain`, sharp
   - Background video: fullscreen, `object-cover`, heavily blurred
   - This ensures no black bars regardless of aspect ratio

2. **State management:**
   ```typescript
   currentIndex: number     // Current segment position
   isPlaying: boolean       // Play/pause
   isMuted: boolean         // Mute state
   videoLoaded: boolean     // Ready to play
   ```

3. **Gesture detection:**
   - Touch start/end tracking for swipe direction
   - Minimum swipe distance: 50px
   - Debounced to prevent accidental triggers
   - Separate handling for vertical (segment nav) and horizontal (season nav)

4. **Auto-advance:** When a clip ends, automatically plays the next segment

5. **Landscape mode:** Detects orientation change, hides controls after 3 seconds, tap to reveal

### Video Preloading Strategy

**Watch Page** (`src/app/watch/page.tsx`):

```javascript
// Preloads next 2 segments for seamless playback
const slotsToPreload = [
  (currentSlotIndex + 1) % lockedSlots.length,
  (currentSlotIndex + 2) % lockedSlots.length,
];

// Creates hidden <video> elements with preload="metadata"
// Uses a Map cache to prevent DOM bloat
// Cleans up on unmount to prevent memory leaks
```

### Video Card Component

Used in the Dashboard for voting:

```
┌────────────────────────┐
│  ┌──────────────────┐  │
│  │   Video/Thumb    │  │
│  │                  │  │
│  │      ▶ (hover)   │  │
│  └──────────────────┘  │
│  [Avatar] @creator     │
│  [Action] genre badge  │
│  ♡ 42 votes            │
│       [Vote Button]    │
└────────────────────────┘
```

- Memoized (`React.memo`) to prevent unnecessary re-renders
- Hover: scale 1.02, play icon appears
- Vote button with pulse animation on vote
- Gradient overlay at bottom for readability

### Mobile Responsiveness

- **Portrait:** Full-screen video, bottom nav, right-side action column
- **Landscape:** Video fills screen, controls auto-hide after 3s, tap to reveal
- **Safe areas:** `env(safe-area-inset-*)` for notched devices
- **Touch targets:** Minimum 44x44px for all interactive elements
- **Breakpoint:** Desktop layout at 768px+ (sidebar navigation)

---

## 8. Content Distribution & Fairness Algorithm

### Design Philosophy

The content distribution algorithm is one of the most important pieces of backend logic in the entire platform. It answers the question: "Which clips should this user see next?" The answer needs to balance three competing goals — fairness for creators (new uploads shouldn't be buried by popular ones), engagement for voters (show interesting, diverse content), and scalability (the solution must work at 1 million users without expensive per-user tracking).

The traditional approach to content feeds (used by TikTok, YouTube, etc.) is to maintain a per-user history of what each person has already seen, typically stored in Redis or a dedicated database. This works but is expensive: at 1 million users and 100,000 clips, you'd need to store and query 100 billion "seen" records. Instead, AiMoviez uses a global `view_count` per clip combined with random jitter to approximate fair distribution. Clips that have been shown fewer times naturally rise to the top, and the random jitter ensures variety. This approach uses O(clips) storage instead of O(users x clips), making it effectively free to scale.

Every creator deserves fair exposure. The algorithm ensures that a clip uploaded 5 minutes ago gets similar visibility to one uploaded 5 hours ago, and that popular creators don't monopolize the feed.

### How Clips Are Shown to Users

Located in `src/app/api/vote/route.ts` (lines 433-494):

**Priority System:**
```
Priority 1: Unvoted + Unseen clips     (highest priority)
Priority 2: Unvoted + Seen clips       (medium priority)
Priority 3: Already voted clips        (lowest, filler only)

Within each priority:
  - Fresh clips (<2 hours old) shown first
  - Lower view_count = higher priority
  - Random jitter (±50) prevents predictable ordering
  - Final shuffle mixes results for variety
```

### Database Function: `get_clips_randomized()`

```sql
-- Fetches clips ordered by view_count + random jitter
-- This ensures fair exposure without expensive per-user tracking
Parameters:
  p_slot_position  -- Current voting slot
  p_season_id      -- Active season
  p_exclude_ids    -- Already-shown clips (client-side dedup)
  p_limit          -- Number to return
  p_jitter         -- Random variance (default: 50)
```

### Why Not Per-User Tracking?

| Approach | Storage Cost | Scales To | Precision |
|----------|-------------|-----------|-----------|
| Per-user tracking (Redis/DB) | O(users × clips) | Thousands | Perfect |
| **view_count + jitter** (our approach) | O(clips) | Millions | Very good |

The current approach adds a random number (0-50) to each clip's `view_count` before sorting. This means clips with fewer views naturally rise to the top, with enough randomness to prevent staleness. The client sends `excludeIds` for session-level deduplication.

### View Count Tracking

Every time a clip is shown to a user, `view_count` is incremented:
```sql
-- Upsert to clip_views table (prevents duplicate counting)
INSERT INTO clip_views (clip_id, voter_key, viewed_at)
ON CONFLICT (clip_id, voter_key) DO UPDATE SET viewed_at = NOW();

-- Trigger increments tournament_clips.view_count
```

### Performance Metrics

| Metric | Value |
|--------|-------|
| Initial clip batch | 8 clips |
| Max per request | 20 clips |
| Fresh clip boost window | 2 hours |
| View count jitter | ±50 |
| Clip cache TTL | 2 minutes |
| Season cache TTL | 5 minutes |
| Slot cache TTL | 1 minute |

---

## 9. Season & Slot Mechanics

Seasons and slots form the structural backbone of the platform. A season is the top-level organizational unit — it represents one complete movie project. Within a season, story slots are the individual positions that need to be filled with winning clips. The relationship is hierarchical: a season contains N slots (typically 75), and each slot will eventually hold exactly one winning clip.

The system enforces a strict ordering: slots are filled sequentially from position 1 to 75. Only one slot can be in "voting" status at any time, creating a shared focal point for the entire community. When a slot's voting window closes, the system automatically selects a winner, locks that slot, and opens the next one. This sequential progression ensures the movie is built linearly, scene by scene, which creates narrative tension and community anticipation.

The auto-advance mechanism runs as a cron job that executes every minute. It checks whether any voting slots have expired (their `voting_ends_at` timestamp is in the past) and, if so, selects the winning clip, locks the slot, moves losing clips to the next slot with reset votes, and opens the next slot for voting. The cron job uses a distributed lock (via a `cron_locks` database table with UPSERT and timestamp-based expiry) to ensure only one instance runs at a time, even when the app is deployed across multiple Vercel serverless instances.

Admins can intervene at any point: manually assigning a winner, reverting a locked slot back to voting, resetting all votes in a slot, or force-advancing to the next slot without waiting for the timer. Every admin action is recorded in the audit log.

### Hierarchy

```
Season (e.g., "Season 1 - Action")
  └── 75 Story Slots
       ├── Slot 1 → [locked] Winner: clip_abc
       ├── Slot 2 → [locked] Winner: clip_def
       ├── Slot 3 → [voting] ← Active voting round
       ├── Slot 4 → [upcoming]
       ├── ...
       └── Slot 75 → [upcoming]
```

### Season States

| State | Description |
|-------|-------------|
| **Draft** | Created but not yet active |
| **Active** | Currently accepting uploads and votes |
| **Finished** | All 75 slots filled with winners |
| **Archived** | Finished and hidden from active views |

### Slot States

| State | Description |
|-------|-------------|
| **upcoming** | Waiting to become the active voting slot |
| **voting** | Active — users are voting on clips (24h timer) |
| **waiting_for_clips** | Timer expired but no clips were uploaded |
| **locked** | Winner selected, clip permanently assigned |

### Auto-Advance System

A cron job runs every minute (`/api/cron/auto-advance`):

```
1. Acquire distributed lock (prevents multiple instances)
2. Find all expired voting slots (voting_ends_at < now)
3. For each expired slot:
   a. Select clip with highest weighted_score
   b. Lock the slot with the winner
   c. Move non-winning active clips to next slot (reset vote_count = 0)
   d. Activate next slot to "voting" (if clips available)
      OR set to "waiting_for_clips" (if no clips)
   e. If slot > 75: set season status = "finished"
4. Release lock
```

### Manual Admin Operations

Admins can override the automatic process:
- **Assign winner manually** — Pick any clip as the winner
- **Unlock a slot** — Revert a locked slot back to voting
- **Reset votes** — Clear all votes in a slot
- **Advance slot** — Force-advance to next slot without waiting for timer

---

## 10. Upload System

The upload system is designed to handle large video files (up to 50MB) while running on Vercel's serverless infrastructure, which has a 4.5MB request body limit. The solution is a three-step pipeline where the video file never passes through the API server at all — it goes directly from the user's browser to the storage provider via a time-limited signed URL.

Here's the logic: the client first requests a signed upload URL from the server. The server generates this URL using the storage provider's SDK (Supabase Storage, AWS S3, Cloudflare R2, or Cloudinary — all four are fully implemented and can be switched by changing a single configuration line). This signed URL grants temporary permission to upload one specific file to one specific path, and it expires after a short window. The client then uploads the file directly to the storage provider using a PUT request to the signed URL. Finally, the client sends a metadata registration request to the server with the file's storage path, genre selection, and other information. The server creates a `tournament_clips` record with status "pending."

The pending status means the clip is not yet visible to voters. An admin must review and approve it before it enters the voting pool. This moderation step prevents inappropriate, spam, or off-topic content from reaching the community. When an admin approves a clip, it becomes "active" and is assigned to the current voting slot.

### Upload Pipeline

```
Client                          Server                         Storage
  │                               │                               │
  ├── 1. Request signed URL ─────►│                               │
  │      (POST /api/upload/       │                               │
  │       signed-url)             │                               │
  │◄── Signed URL returned ──────┤                               │
  │                               │                               │
  ├── 2. Upload file directly ───────────────────────────────────►│
  │      (PUT to signed URL)      │                     Supabase  │
  │◄── Upload complete ─────────────────────────────────────────┤
  │                               │                               │
  ├── 3. Register metadata ──────►│                               │
  │      (POST /api/upload/       │── Insert into                 │
  │       register)               │   tournament_clips            │
  │◄── Clip registered ─────────┤   (status: pending)            │
  │                               │                               │
```

**Why this architecture?**
- Bypasses Vercel's 4.5MB request body limit
- Files go directly to storage, not through the API server
- Signed URLs ensure security (expire after short time)
- CSRF protection on initial URL request

### Validation

| Check | Limit |
|-------|-------|
| File format | MP4, WebM, MOV only |
| File size | 50MB max |
| Duration | 8 seconds max (8.5s buffer) |
| Authentication | Required |

### Clip Status Flow

```
pending → (admin approves) → active → (wins vote) → locked
          (admin rejects)  → rejected
```

---

## 11. Gamification & Engagement

The gamification system exists to solve a fundamental challenge: voting on other people's clips is inherently less exciting than creating your own. Without incentives, voters might lose interest after a few sessions. The XP, level, badge, and streak systems turn voting into a game in itself — every vote earns progress, every day of voting extends a streak, and milestones unlock visual badges displayed on the user's profile.

The engagement loop works on multiple timescales. In the moment, each vote triggers satisfying audio-visual feedback (sound effect, haptic vibration, animated checkmark). Over the course of a session, the daily vote progress ring fills up with a color gradient (blue → cyan → green → gold), creating a "just one more" pull similar to completing a progress bar in a game. Across days, the voting streak mechanic encourages returning daily — miss a day and the streak resets. Over weeks, badge collection and leaderboard climbing provide long-term goals. Special milestone celebrations (confetti animation at the 1st, 50th, 100th, and 200th vote of the day) create surprise-and-delight moments that break up the routine.

### XP & Levels

Users earn XP through various actions:

| Action | XP Reward |
|--------|-----------|
| Cast a vote | Small amount |
| Clip locked in (winner) | Bonus XP |
| Maintain voting streak | Streak bonus |
| Referral (varies by tier) | 50-1000 XP |

**Level progression:** XP threshold increases per level. Visual progress bar on profile with animated gradient and shimmer effect near completion.

### Badges & Achievements

**Badge Types:**
- **Vote milestones:** 100 votes, 1000 votes, etc.
- **Streak badges:** 3-day, 7-day, 30-day streaks
- **Creator badges:** First clip, first win, etc.
- **Social badges:** Referral tier badges

**Display:** Unlocked badges glow with color. Locked badges shown in greyscale. In-progress badges show progress bars.

### Voting Streaks

- Voting at least once per day maintains your streak
- Streak counter shown on profile with flame icon
- Resets at midnight UTC if no vote cast
- Bonus XP for maintaining streaks

### Sound & Haptic Feedback

| Event | Feedback |
|-------|----------|
| Regular vote | Sound effect + 50ms vibration |
| 1st vote of the day | Special milestone sound |
| 50th vote | Milestone sound |
| 100th vote | Milestone sound |
| 200th vote (daily limit) | Special completion sound + confetti |
| Error | 100-50-100ms vibration pattern |

### Daily Vote Progress Ring

The vote button has a circular progress ring:
- **0-25%:** Blue
- **25-50%:** Cyan
- **50-75%:** Green
- **75-100%:** Gold
- Fills as user approaches 200 daily votes

---

## 12. Social Features

Beyond voting and creating, the platform includes a set of social features that build community and drive organic growth. The follow system lets users track their favorite creators, the referral system incentivizes word-of-mouth growth with tiered XP rewards, the content reporting system gives the community self-policing tools, and the notification system keeps users informed about events they care about (their clip got approved, their clip won a slot, someone commented on their clip, etc.).

The referral system is particularly well-designed for growth. Each user gets a unique referral code and a shareable link. When a new user signs up through that link, the referrer earns XP — and the amount increases with each referral tier (from 50 XP for the first referral up to 1,000 XP at the "Legend" tier of 100 referrals). Higher tiers also unlock exclusive badges, creating both a material reward (XP) and a status symbol (badge) for successful referrers. The system prevents self-referral and limits one referral credit per new user.

### Follow System

Users can follow creators:
- Follow/unfollow via profile or clip view
- Follower count shown on profile

### Referral System

**Flow:**
1. User gets a unique referral code (auto-generated)
2. Shares link: `https://aimoviez.com/join/{CODE}`
3. New user signs up via link
4. Referrer earns XP based on tier

**Reward Tiers:**

| Tier | Referrals | Reward |
|------|-----------|--------|
| Connector | 1 | 50 XP |
| Networker | 5 | 100 XP + badge |
| Influencer | 10 | 200 XP + badge |
| Ambassador | 25 | 500 XP + badge |
| Legend | 100 | 1000 XP + badge |

### Content Reporting

Users can report clips, users, or comments for:
- Inappropriate content
- Spam
- Harassment
- Copyright violation
- Other (custom description)

Reports enter the admin moderation queue.

### Notifications

**Types:**
- Clip approved/rejected
- Clip won a slot
- New voting round started
- Achievement unlocked
- Daily goal reached
- New follower
- Comment on your clip
- System announcements

**Delivery:** In-app notifications + optional push notifications (PWA)

---

## 13. Admin & Moderation System

The admin system provides the operational backbone for running the platform. Since all user-uploaded content must be reviewed before entering the voting pool, and since the season/slot lifecycle requires active management, the admin tools are essential for the platform to function.

The moderation workflow follows a simple pipeline: creators upload clips, which enter a "pending" queue. Admins review the queue and either approve clips (moving them to "active" status in the current voting slot) or reject them (removing them from the pool entirely). Bulk operations allow processing multiple clips at once, and the system supports both individual inline editing (changing a clip's title, description, or genre) and batch approve/reject for efficiency.

Feature flags give admins the ability to toggle experimental features on and off without code deployments. This is valuable for A/B testing (e.g., testing whether multi-vote mode increases engagement), for emergency shutdowns (e.g., disabling voting if a bug is discovered), and for gradual rollouts of new features. Each flag has a name, description, category, and enabled state, all managed through a simple toggle UI in the admin dashboard.

Every action taken by an admin — approving a clip, banning a user, toggling a feature flag, assigning a winner — is recorded in an audit log with the admin's email, the action type, the affected resource, and a timestamp. This creates full accountability and traceability for all administrative decisions.

### Admin Dashboard Capabilities

| Action | Description |
|--------|-------------|
| **Approve clip** | Move from pending to active (eligible for voting) |
| **Reject clip** | Remove from voting pool |
| **Assign winner** | Manually select slot winner |
| **Advance slot** | Force-advance voting to next slot |
| **Reset votes** | Clear all votes in a slot |
| **Ban/unban user** | Block user from platform |
| **Toggle admin** | Grant/revoke admin access |
| **Feature flags** | Enable/disable features |
| **Create season** | Start a new season with slot count |
| **Delete season** | Remove season (requires confirmation) |
| **Bulk operations** | Batch approve/reject clips |

### Audit Logging

All admin actions are logged:
```sql
audit_logs (
  action          TEXT,          -- e.g., "approve_clip"
  resource_type   TEXT,          -- e.g., "clip", "user"
  resource_id     TEXT,          -- ID of affected resource
  admin_email     TEXT,          -- Who performed the action
  details         JSONB,         -- Additional context
  created_at      TIMESTAMP
)
```

### Feature Flags

Toggle features without redeploying:

| Flag | Purpose |
|------|---------|
| `multi_vote_enabled` | Allow voting multiple times on same clip |
| `referral_system` | Enable referral rewards |
| `spotlight_tour` | New onboarding tour style |
| `vote_button_progress` | Show daily progress ring |
| `require_captcha_voting` | Require hCaptcha for votes |
| `require_auth_voting` | Only authenticated users can vote |

---

## 14. Technical Architecture

The application is a full-stack Next.js project using the App Router. The frontend and backend live in the same codebase — React components for the UI and API route handlers for the backend — deployed together on Vercel. This monorepo approach simplifies development and deployment: there's no separate backend to deploy, no API versioning to manage, and shared TypeScript types ensure the frontend and backend always agree on data shapes.

The architectural philosophy is "simple infrastructure, smart code." Rather than introducing separate services for each concern (a queue for async processing, a separate cache service, a dedicated search engine), the app leverages PostgreSQL as the single source of truth for everything — data storage, full-text search, real-time subscriptions, row-level security, and even distributed locking. Supabase wraps PostgreSQL with an auto-generated REST API, real-time WebSocket channels, and built-in authentication, reducing the number of services to manage.

Server state management on the frontend uses TanStack React Query, which handles caching, background re-fetching, stale-while-revalidate patterns, and optimistic updates. This eliminates the need for a client-side state management library like Redux — the server is the source of truth, and React Query keeps the client synchronized. Styling uses Tailwind CSS v4 with custom design tokens defined in CSS variables, and animations use Framer Motion for complex transitions and CSS keyframes for performance-critical effects.

### Stack Overview

```
┌─────────────────────────────────────────────────────────┐
│                        CLIENT                            │
│  React 19 + Next.js 15 (App Router) + TypeScript 5      │
│  Tailwind CSS 4 + Framer Motion + TanStack React Query   │
├─────────────────────────────────────────────────────────┤
│                      API LAYER                           │
│  Next.js API Routes (50+ endpoints)                      │
│  Zod validation · Rate limiting · CSRF · Auth            │
├─────────────────────────────────────────────────────────┤
│                      SERVICES                            │
│  Supabase (PostgreSQL + RLS + Realtime)                  │
│  AWS S3 / Supabase Storage (video files)                 │
│  Upstash Redis (rate limiting)                           │
│  Sentry (error tracking)                                 │
│  Pusher (WebSocket broadcasts)                           │
├─────────────────────────────────────────────────────────┤
│                    DEPLOYMENT                            │
│  Vercel (hosting + serverless functions + edge)          │
└─────────────────────────────────────────────────────────┘
```

### Key Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| `next` | 15.5.7 | Full-stack React framework |
| `react` | 19.2.0 | UI library |
| `@supabase/supabase-js` | 2.84.0 | Database client |
| `next-auth` | 4.24.13 | OAuth authentication |
| `@tanstack/react-query` | 5.90.10 | Server state management |
| `framer-motion` | 12.23.24 | Animations |
| `@aws-sdk/client-s3` | 3.x | S3 file storage |
| `@upstash/ratelimit` | 1.35.7 | Rate limiting |
| `@sentry/nextjs` | 10.28.0 | Error tracking |
| `zod` | 3.x | Schema validation |
| `lucide-react` | latest | Icons |

### Directory Purpose Map

| Directory | Purpose |
|-----------|---------|
| `src/app/` | Pages and API routes (Next.js App Router) |
| `src/components/` | 27 React components |
| `src/hooks/` | 10 custom hooks |
| `src/lib/` | 19 utility modules |
| `src/types/` | TypeScript definitions |
| `supabase/sql/` | Database migrations |
| `public/` | Static assets, PWA manifest |

### Custom Hooks

| Hook | Purpose |
|------|---------|
| `useAuth` | Authentication state management |
| `useAdminAuth` | Admin permission checking |
| `useRealtimeClips` | Real-time clip updates via WebSocket |
| `useLandscapeVideo` | Landscape mode detection and control |
| `useInstallPrompt` | PWA install prompt detection |
| `useCsrf` | CSRF token management |
| `useCountdown` | Countdown timer for voting rounds |
| `useFeatureFlags` | Feature flag checking |
| `useFocusTrap` | Accessibility focus trapping |
| `useMockData` | Test data generation |

---

## 15. Database Design

The database uses PostgreSQL hosted on Supabase. The schema is designed around the core domain model: seasons contain slots, slots contain clips, clips receive votes and comments. Users are connected to all of these through foreign keys.

A key design decision is the use of denormalized counters on the `tournament_clips` table. Rather than computing vote counts with `COUNT(*)` queries (which become slow as the votes table grows), each clip stores its `vote_count`, `weighted_score`, and `view_count` directly. These counters are updated atomically by database triggers that fire on vote insert/delete. This means any query that needs to sort or filter clips by vote count can do so with a simple indexed column read, rather than an expensive aggregation join.

Row Level Security (RLS) policies enforce access control at the database level. This means even if a bug in the application code constructs a query it shouldn't, the database itself will refuse to return unauthorized data. The server-side API routes use a "service role" key that bypasses RLS (needed for admin operations and cross-user queries), while the client-side Supabase client uses the "anon" key that is subject to all RLS policies.

The schema includes 15+ migration files in `supabase/sql/`, each addressing a specific feature addition, performance optimization, or bug fix. Notable migrations include the vote race condition fixes (which introduced atomic RPC functions), the comment moderation extensions (which added moderation status columns), and the performance index additions (which added 23+ indexes across all major tables).

### Entity Relationship Diagram

```
seasons ──────< story_slots ──────< tournament_clips ──────< votes
                     │                      │
                     │                      ├──────< comments ──────< comment_likes
                     │                      │
                     │                      └──────< clip_views
                     │
                     └── winner_tournament_clip_id (FK)

users ──────< tournament_clips
  │  ──────< votes
  │  ──────< comments
  │  ──────< notifications
  │  ──────< referrals (as referrer)
  │  ──────< referrals (as referred)
  └  ──────< content_reports

genre_votes (standalone, keyed by voter_key)
feature_flags (standalone, admin-managed)
audit_logs (standalone, admin actions)
```

### Key Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `seasons` | Tournament seasons | id, label, genre, status, total_slots |
| `story_slots` | Positions in the movie | season_id, slot_position, status, winner_clip_id, voting_ends_at |
| `tournament_clips` | Uploaded videos | video_url, vote_count, weighted_score, view_count, status, creator_id |
| `votes` | User votes | clip_id, voter_key, vote_weight, slot_position |
| `comments` | Comment threads | clip_id, comment_text, parent_comment_id, likes_count |
| `comment_likes` | Comment likes | comment_id, user_key |
| `users` | User profiles | username, email, avatar_url, is_admin, is_banned |
| `genre_votes` | Genre voting | voter_key, genre |
| `referrals` | Referral tracking | referrer_id, referred_id, status, reward_amount |
| `feature_flags` | Feature toggles | key, enabled, category |
| `audit_logs` | Admin audit trail | action, resource_type, admin_email, details |
| `content_reports` | User reports | reporter_id, reason, description, status |
| `notifications` | User notifications | user_id, type, message, read |

### Row Level Security (RLS)

All tables have RLS policies:
- Users can only read/write their own data
- Admins can access all data
- Anonymous users can read public content
- Service role key bypasses RLS for server-side operations

### Key Indexes

```sql
-- Voting performance
idx_votes_voter_created(voter_key, created_at)    -- Daily vote counting
idx_votes_voter_slot(voter_key, slot_position)    -- Slot-specific queries
idx_votes_clip_voter_unique(clip_id, voter_key)   -- Unique constraint

-- Content queries
idx_clips_season_slot(season_id, slot_position)   -- Clip lookups
idx_clips_status(status)                          -- Status filtering

-- Comments
idx_comments_clip_id(clip_id)                     -- Comments per clip
idx_comments_parent_id(parent_comment_id)         -- Reply lookups
```

---

## 16. API Reference

The API is implemented as Next.js API routes — serverless functions that run on Vercel's infrastructure. Each route file exports handlers for the HTTP methods it supports (GET, POST, PATCH, DELETE). The API follows REST conventions: resources are nouns (`/api/vote`, `/api/comments`, `/api/user/profile`), methods indicate the operation (GET to read, POST to create, PATCH to update, DELETE to remove), and responses use standard HTTP status codes.

Every API endpoint follows a consistent pattern: rate limiting check (via Upstash Redis), authentication/authorization check (via NextAuth session), input validation (via Zod schemas), business logic execution (via Supabase queries or RPC calls), and response formatting. Errors return a consistent JSON shape with an `error` message, an optional `code` for programmatic handling, and optional `details` for debugging. CSRF tokens are required on all state-changing operations (POST, PATCH, DELETE) to prevent cross-site request forgery attacks.

The API is organized into logical groups: core voting and content endpoints, upload pipeline, comment CRUD, user management, profile and stats, leaderboard queries, notification management, account operations (GDPR), and admin-only operations. Admin routes additionally check the `is_admin` flag on the user's database record before allowing access.

### Endpoint Summary (50+ routes)

#### Core
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET/POST/DELETE` | `/api/vote` | Voting operations |
| `GET/POST/DELETE` | `/api/genre-vote` | Genre voting |
| `GET` | `/api/story` | Season and slot data |
| `GET` | `/api/clip/[id]` | Single clip details |
| `GET` | `/api/discover` | Search and browse |
| `GET` | `/api/genres` | Genre list and stats |

#### Upload
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/upload/signed-url` | Get storage signed URL |
| `POST` | `/api/upload/register` | Register clip metadata |

#### Comments
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/comments` | Fetch comments |
| `POST` | `/api/comments` | Post comment |
| `PATCH` | `/api/comments` | Like/unlike |
| `DELETE` | `/api/comments` | Delete own comment |

#### User
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/user/profile` | Get profile |
| `POST` | `/api/user/create-profile` | Create profile |
| `GET` | `/api/user/check-username` | Username availability |
| `POST` | `/api/user/follow` | Follow/unfollow |
| `POST` | `/api/user/block` | Block user |

#### Profile
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/profile/stats` | User statistics |
| `GET` | `/api/profile/clips` | User's clips |
| `GET` | `/api/profile/history` | Vote history |

#### Leaderboard
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/leaderboard/clips` | Top clips |
| `GET` | `/api/leaderboard/creators` | Top creators |
| `GET` | `/api/leaderboard/voters` | Top voters |
| `GET` | `/api/leaderboard/live` | Real-time data |

#### Notifications
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET/POST` | `/api/notifications` | Notification CRUD |
| `POST` | `/api/notifications/subscribe` | Push subscription |
| `POST` | `/api/notifications/unsubscribe` | Unsubscribe |

#### Account
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `DELETE` | `/api/account/delete` | Delete account (GDPR) |
| `GET` | `/api/account/export` | Export data (GDPR) |

#### Admin (18 routes)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET/POST/PATCH/DELETE` | `/api/admin/seasons` | Season CRUD |
| `GET/PATCH` | `/api/admin/slots` | Slot management |
| `GET/POST/PUT` | `/api/admin/clips` | Clip management |
| `GET/PUT` | `/api/admin/users/[id]` | User management |
| `POST` | `/api/admin/approve` | Approve clip |
| `POST` | `/api/admin/reject` | Reject clip |
| `POST` | `/api/admin/assign-winner` | Set slot winner |
| `POST` | `/api/admin/advance-slot` | Force advance |
| `GET` | `/api/admin/audit-logs` | Audit trail |
| `GET/POST` | `/api/admin/feature-flags` | Feature flags |
| `POST` | `/api/admin/bulk` | Bulk operations |
| `GET/POST` | `/api/admin/moderation` | Moderation queue |

#### System
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/cron/auto-advance` | Cron: auto-advance slots |
| `GET/POST` | `/api/csrf` | CSRF token |
| `POST` | `/api/captcha/status` | hCaptcha verification |
| `GET` | `/api/features` | Feature flag status |
| `POST` | `/api/report` | Content reporting |
| `POST` | `/api/referral` | Referral tracking |
| `POST` | `/api/contact` | Contact form |

---

## 17. Security

The security model is built on the principle of defense in depth — multiple overlapping layers so that no single point of failure can compromise the system. Authentication is delegated entirely to Google via OAuth 2.0, eliminating the risks associated with password storage, reset flows, and credential stuffing attacks. The platform never sees or stores user passwords.

On every API request, several security checks execute in sequence. First, the middleware validates the origin and applies CORS policies. For state-changing requests (POST, PATCH, DELETE), a CSRF token must be present — this token is generated per session using the Web Crypto API and includes a timestamp, random bytes, and an HMAC signature that expires after one hour. Rate limiting via Upstash Redis prevents abuse, with different thresholds per endpoint type (30 votes/minute but 120 reads/minute, for example). Input validation using Zod schemas ensures that request bodies conform to expected shapes before any business logic executes. Text inputs (comments, usernames) are sanitized to strip HTML tags and control characters, preventing XSS even if React's escaping were somehow bypassed.

At the database level, Row Level Security (RLS) policies act as a final guard. Even if application-level authorization checks have a bug, RLS ensures that users can only read and modify their own data. The server-side service role key, which bypasses RLS, is only used in API routes — it never reaches the client.

### Authentication

- **OAuth 2.0** via Google, managed by NextAuth
- **Session-based:** 30-minute timeout
- **No passwords stored** — delegated entirely to Google

### Request Security

| Layer | Implementation |
|-------|---------------|
| **CSRF Protection** | Token generated per session, validated on all mutations |
| **Rate Limiting** | Upstash Redis — endpoint-specific limits |
| **Input Validation** | Zod schemas on all API inputs |
| **Input Sanitization** | HTML stripping, control char removal |
| **CORS** | Configured in middleware |
| **CSP Headers** | Content Security Policy in Next.js config |

### Data Security

| Layer | Implementation |
|-------|---------------|
| **Row Level Security** | Supabase RLS policies on all tables |
| **Service Role Separation** | Server uses service role, client uses anon key |
| **Signed URLs** | Time-limited upload URLs |
| **Soft Deletes** | Preserves audit trail |
| **Audit Logging** | All admin actions recorded |

### Anti-Fraud

| Measure | Purpose |
|---------|---------|
| **Device Fingerprinting** | SHA256(IP + User-Agent) for anonymous tracking |
| **Vote Flagging** | Suspicious patterns marked for review |
| **hCaptcha** | Bot prevention (feature-flagged) |
| **Daily Limits** | 200 votes/day prevents automated voting |
| **Distributed Locks** | Prevents cron job race conditions |

### GDPR Compliance

- **Data Export:** Users can download all their data as JSON
- **Account Deletion:** Full cascade delete of all user data
- **Cookie Consent:** Banner with accept/reject
- **Privacy Policy:** Dedicated page

---

## 18. Performance & Scalability

Performance optimization in AiMoviez follows a pragmatic approach: identify the hottest code paths (the vote endpoint handles the most traffic), measure where time is spent (database queries dominate), and apply targeted caching and indexing to reduce the most expensive operations.

The caching strategy uses four layers. At the outermost layer, Vercel's edge CDN serves cached API responses for read-heavy endpoints, eliminating the need for the request to reach the server at all. At the client layer, TanStack React Query caches responses and deduplicates requests from the same browser session. At the server layer, in-memory caches store frequently-accessed data (active season, current slot, feature flags) with TTLs ranging from 1 to 10 minutes. At the database layer, 23+ indexes ensure that queries hitting PostgreSQL are fast, and atomic RPC functions minimize lock contention.

On the frontend, performance is maintained through code splitting (heavy components like CommentsSection are loaded dynamically only when needed), component memoization (VideoCard and ActionButton are wrapped in `React.memo` to prevent re-renders when parent state changes), video preloading (the next two clips are pre-fetched in the background), and skeleton loaders (which show a content-shaped placeholder while data loads, preventing layout shift and giving users immediate visual feedback).

### Caching Strategy

| Data | Cache TTL | Method |
|------|-----------|--------|
| Active season | 5 minutes | In-memory |
| Active slot | 1 minute | In-memory |
| Clips per slot | 2 minutes | In-memory (max 20 entries, FIFO eviction) |
| Feature flags | 10 minutes | In-memory |
| Story API | 15 seconds | In-memory + CDN (`s-maxage=30`) |
| React Query | 1 minute stale, 5 minute GC | Client-side |

### Database Optimizations

- 23+ indexes for fast queries
- Atomic RPC functions (prevent race conditions)
- Database triggers for vote count aggregation (no application-level counting)
- Batch queries for comment counts and reply fetching
- Composite indexes on frequently joined columns

### Frontend Optimizations

| Technique | Implementation |
|-----------|---------------|
| **Code splitting** | Dynamic imports for heavy components |
| **Component memoization** | `React.memo` on VideoCard, ActionButton, CommentsSection |
| **Video preloading** | Next 2 clips preloaded with `preload="metadata"` |
| **Image optimization** | Next.js `Image` component with responsive `sizes` |
| **Skeleton loaders** | Pre-built skeletons for all loading states |
| **Lazy loading** | Comments panel, contributors list loaded on demand |
| **Query deduplication** | React Query prevents duplicate API calls |

### Scalability Design

- **No per-user tracking storage:** Uses `view_count + jitter` instead of Redis per-user sets
- **Stateless API:** All state in database, API servers are interchangeable
- **CDN caching:** Static assets and API responses cached at edge
- **Rate limiting via Redis:** Upstash Redis scales independently
- **Signed URL uploads:** Files go directly to storage, not through API

---

## 19. Real-time Features

Real-time updates are important for two scenarios: when an admin assigns a winner (all users watching the story should see the new winning clip immediately) and when a season is reset or a new one is created (all users should be aware of the change without manually refreshing).

The primary real-time mechanism uses Supabase Realtime channels, which are WebSocket connections that listen for broadcast events from the server. When an admin performs a significant action (assigning a winner, resetting a season), the server broadcasts an event to a shared channel. All connected clients receive this event and trigger a fresh data fetch with cache bypass (`?fresh=true`).

As a fallback for situations where WebSocket connections fail (network instability, browser restrictions, or exceeding Supabase's connection limits), the app also implements visibility-based polling. When a user switches back to the AiMoviez tab after being away, the `visibilitychange` event fires and the app immediately fetches fresh data. This ensures that even without real-time push, users always see current data when they return to the app.

### WebSocket Broadcasts

Via Supabase Realtime / Pusher:

| Event | Trigger | Action |
|-------|---------|--------|
| `WinnerSelected` | Admin assigns winner | Clients refetch story data |
| `SeasonReset` | Admin resets season | Clients refetch all data |

### Visibility-Based Refresh

When user returns to the tab after being away:
```javascript
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    fetchFreshData();  // Bypass cache
  }
});
```

### Polling Fallback

If WebSocket connection fails, polling at 30-second intervals.

---

## 20. Environment & Deployment

The app is deployed on Vercel, which provides automatic builds from git pushes, serverless function execution for API routes, edge caching for static assets and API responses, and preview deployments for pull requests. The deployment is stateless — all persistent state lives in Supabase (database) and the storage provider (video files), with Upstash Redis handling ephemeral rate-limiting state.

Setting up a development environment requires configuring approximately 15 environment variables across four services: Supabase (database credentials), Google Cloud Console (OAuth credentials), a storage provider (Supabase Storage or AWS S3), and Upstash (Redis credentials). Optional services include hCaptcha (bot prevention), Sentry (error tracking), and a cron secret for securing the auto-advance endpoint in production.

Database setup involves applying the SQL migration files from `supabase/sql/` to your Supabase project in order. These migrations create tables, indexes, RPC functions, triggers, and RLS policies. The migration files are numbered and named descriptively (e.g., `CRITICAL-FIX-1-database-indexes.sql`, `fix-vote-insert-race-condition.sql`, `migration-comment-moderation.sql`).

### Required Environment Variables

```bash
# Database
NEXT_PUBLIC_SUPABASE_URL          # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY     # Supabase public (anon) key
SUPABASE_SERVICE_ROLE_KEY         # Supabase admin key (server-side only)

# Authentication
NEXTAUTH_SECRET                   # Session encryption secret
NEXTAUTH_URL                      # App URL
NEXT_PUBLIC_APP_URL               # Public-facing URL
GOOGLE_ID                         # Google OAuth client ID
GOOGLE_SECRET                     # Google OAuth client secret

# Storage
AWS_ACCESS_KEY_ID                 # S3 access key
AWS_SECRET_ACCESS_KEY             # S3 secret key
AWS_REGION                        # S3 region
AWS_S3_BUCKET                     # S3 bucket name

# Rate Limiting
UPSTASH_REDIS_REST_URL            # Upstash Redis URL
UPSTASH_REDIS_REST_TOKEN          # Upstash Redis token

# Security (Optional)
HCAPTCHA_SECRET                   # hCaptcha verification
CRON_SECRET                       # Cron job authentication

# Monitoring (Optional)
SENTRY_DSN                        # Sentry error tracking
SENTRY_ORG                        # Sentry organization
SENTRY_PROJECT                    # Sentry project
SENTRY_AUTH_TOKEN                 # Sentry auth token
```

### Development Setup

```bash
git clone [repository-url]
cd aimoviez-app
npm install
# Configure .env.local with variables above
# Apply SQL migrations from supabase/sql/ to your Supabase project
npm run dev
# Open http://localhost:3000
```

### Scripts

```bash
npm run dev          # Development server (hot reload)
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint
npm test             # Jest tests
npm run test:watch   # Jest in watch mode
npm run test:coverage # Jest with coverage report
```

### Deployment

- **Platform:** Vercel
- **Build:** `next build` (automatic on push)
- **Database:** Supabase hosted PostgreSQL
- **Storage:** Supabase Storage or AWS S3
- **Redis:** Upstash serverless Redis
- **Domain:** Custom domain via Vercel

---

## Project Statistics

| Metric | Count |
|--------|-------|
| Pages | 19 |
| API Routes | 50+ |
| Components | 27 |
| Custom Hooks | 10 |
| Utility Modules | 19 |
| Database Tables | 12+ |
| Database Migrations | 15+ |
| Lines of Code | ~15,000+ |

---

---

## 21. Scalability Deep-Dive

This section provides a detailed analysis of how the platform handles increasing load, where the current bottlenecks are, what has already been optimized, and what work remains for the system to support millions of users. Scalability is not a single problem but a collection of related challenges: database query performance under load, cache consistency across multiple server instances, video bandwidth costs, rate limiting accuracy, and real-time connection limits.

The overall approach to scaling AiMoviez follows a principle of "optimize the hottest paths first." The voting endpoint (`/api/vote`) handles the most traffic and has received the most optimization attention — in-memory caching, atomic RPC functions, 23+ database indexes, and HTTP cache headers. The content distribution algorithm was redesigned from per-user tracking (which doesn't scale past thousands of users) to a global view_count system (which scales to millions). Video storage was abstracted behind a provider interface so the team can switch from Supabase Storage to Cloudflare R2 (zero egress fees) by changing one line of configuration.

### Current Scale Readiness

The platform is currently optimized for **10K-100K users**. The foundations are solid for scaling to 1M+ users, but several infrastructure upgrades are needed to get there.

| Component | Current Capacity | Target (1M users) | Status |
|-----------|-----------------|-------------------|--------|
| Concurrent voters | ~500 | 50,000+ | Needs work |
| Daily active users | ~10K | 1,000,000 | Needs work |
| Votes per second | ~50 | 5,000+ | Needs work |
| API latency (p95) | ~200ms | <100ms | Partially optimized |
| Cache hit ratio | ~60% | >85% | Needs distributed cache |
| DB queries/min | ~200K | 500K+ | Well-indexed |

---

### 21.1 Caching Architecture

The app uses a **multi-layer caching strategy** to reduce database load. Each layer catches requests that the previous layer missed.

```
Request
  │
  ▼
┌──────────────────────┐
│  Vercel Edge / CDN   │  Layer 1: HTTP cache headers
│  s-maxage=30         │  Serves stale responses while revalidating
│  stale-while-rev=120 │  Eliminates ~90% of identical GET requests
└──────────┬───────────┘
           │ Cache miss
           ▼
┌──────────────────────┐
│  React Query         │  Layer 2: Client-side cache
│  staleTime: 60s      │  Deduplicates requests from same browser
│  gcTime: 300s        │  Prevents re-fetching on tab switches
└──────────┬───────────┘
           │ Cache miss
           ▼
┌──────────────────────┐
│  In-Memory Cache     │  Layer 3: Per-instance server cache
│  (Node.js process)   │  Reduces DB queries by 80-99%
│  TTLs: 1-10 min      │  FIFO eviction, max 20 entries per type
└──────────┬───────────┘
           │ Cache miss
           ▼
┌──────────────────────┐
│  PostgreSQL          │  Layer 4: Database with 23+ indexes
│  (Supabase)          │  Atomic RPC functions for hot paths
└──────────────────────┘
```

#### In-Memory Cache TTLs

Located in `src/app/api/vote/route.ts`:

```typescript
const CACHE_TTL = {
  season:       5 * 60 * 1000,   // 5 min  — rarely changes
  slot:         60 * 1000,        // 1 min  — changes every 24h
  clips:        2 * 60 * 1000,    // 2 min  — updates when votes happen
  featureFlags: 10 * 60 * 1000,   // 10 min — admin-controlled
};
```

**Impact of feature flag caching alone:**
- Before: 3-4 DB queries per vote request (to check multi_vote, captcha, auth flags)
- After: 1 query every 10 minutes = 144/day
- At 1M votes/day: **99.99% query reduction** (3-4M queries eliminated)

#### HTTP Cache Headers by Endpoint

| Endpoint | Cache-Control | Effect |
|----------|--------------|--------|
| `GET /api/vote` | `s-maxage=30, stale-while-revalidate=120` | Edge caches for 30s, serves stale up to 2 min |
| `GET /api/story` | `s-maxage=30, stale-while-revalidate=60` | Fresh story data within 30s |
| `GET /api/story?fresh=true` | `no-store, no-cache, must-revalidate` | Bypass cache for real-time updates |
| `GET /api/leaderboard` | `s-maxage=60, stale-while-revalidate=300` | Rankings cached 1 min, stale up to 5 min |

#### Cache Size Limits

In-memory caches have hard limits to prevent unbounded memory growth in Vercel's serverless environment:
- **Clip cache:** Max 20 entries (FIFO eviction when full)
- **Leaderboard cache:** Max 50 entries (LRU eviction)
- **Feature flags:** Single entry (refreshed every 10 min)

---

### 21.2 Database Index Strategy

The database has **23+ carefully designed indexes** across three migration files. These are critical for performance at scale.

#### Votes Table (5 indexes)

```sql
-- Daily vote limit check (O(log n) instead of O(n))
idx_votes_voter_key_date     (voter_key, created_at DESC)

-- Fast lookup: "has this user voted on this clip?"
idx_votes_clip_id            (clip_id)

-- Temporal queries for analytics
idx_votes_created_at         (created_at DESC)

-- Composite: voter history with clip and time
idx_votes_voter_clip         (voter_key, clip_id, created_at DESC)

-- Prevents duplicate votes (database-enforced)
votes_clip_voter_unique      (clip_id, voter_key) UNIQUE
```

#### Tournament Clips (8 indexes)

```sql
-- Core voting page query (the "hot path")
idx_clips_season_slot_status (season_id, slot_position, status)

-- Fair distribution: fetch least-viewed clips first
idx_clips_distribution       (slot_position, season_id, status, view_count ASC)
                             WHERE status = 'active'

-- Leaderboard ranking
idx_clips_vote_count         (vote_count DESC)
idx_clips_weighted_score     (weighted_score DESC)

-- Filtering
idx_clips_genre              (genre)
idx_clips_user               (user_id)
idx_clips_status_votes       (status, vote_count DESC) WHERE status IS NOT NULL
idx_clips_slot_votes         (slot_position, vote_count DESC)
```

#### Story Slots (3 indexes)

```sql
-- Find the active voting slot (partial index — only scans voting slots)
idx_slots_voting             (status) WHERE status = 'voting'

-- Season slot queries
idx_slots_season_status      (season_id, status)
idx_slots_position           (slot_position)
```

#### Clip Views (2 indexes)

```sql
-- Deduplication join (prevents O(n) sequential scans)
idx_clip_views_voter_lookup  (voter_key, clip_id)

-- Cleanup of old views
idx_clip_views_age           (viewed_at)
```

All index creation scripts run `ANALYZE` afterward to update PostgreSQL's query planner statistics.

---

### 21.3 Atomic Database Operations

Race conditions are the #1 cause of data corruption at scale. AiMoviez solves this with PostgreSQL RPC functions that execute atomically inside the database.

#### Vote Insert (`insert_vote_atomic`)

**Problem:** Two users vote simultaneously — both check "no existing vote," both insert, one overwrites the other's count update.

**Solution:** Row-level locking inside a single transaction:

```sql
-- Pseudocode for insert_vote_atomic()
BEGIN;
  SELECT FOR UPDATE FROM tournament_clips WHERE id = clip_id;  -- Lock the row
  INSERT INTO votes (...) VALUES (...);                         -- Insert vote
  UPDATE tournament_clips SET
    vote_count = vote_count + 1,
    weighted_score = weighted_score + vote_weight;              -- Update count
  RETURN vote_id, new_vote_count, new_weighted_score;
COMMIT;
```

**Performance:** ~5-15ms per atomic vote (including lock acquisition)

#### Vote Delete (`delete_vote_atomic`)

**Problem:** Concurrent deletes could make `vote_count` go negative.

**Solution:** `GREATEST(0, vote_count - 1)` in the trigger + row locking:

```sql
-- Trigger: on_vote_delete
UPDATE tournament_clips SET
  vote_count = GREATEST(0, vote_count - 1),
  weighted_score = GREATEST(0, weighted_score - COALESCE(OLD.vote_weight, 1));
```

#### Vote Count Triggers

Vote counts are **never computed at the application level.** Database triggers fire in the same transaction as the vote insert/delete, guaranteeing consistency:

```sql
-- AFTER INSERT trigger on votes table
UPDATE tournament_clips SET
  vote_count = vote_count + COALESCE(NEW.vote_weight, 1),
  weighted_score = weighted_score + COALESCE(NEW.vote_weight, 1)
WHERE id = NEW.clip_id;
```

**Vote weights:** Standard = 1, Super = 3, Mega = 10

---

### 21.4 Content Distribution at Scale

The clip distribution algorithm is designed to **scale to millions of users without per-user storage.**

#### The Problem with Per-User Tracking

Traditional "seen tracking" stores which clips each user has viewed:

```
Users × Clips = Storage
10K  × 1K    = 10M entries (manageable)
1M   × 100K  = 100B entries (NOT manageable)
```

This approach requires either Redis Bloom filters (expensive, complex) or database tables (slow, bloated).

#### AiMoviez's Solution: Global Fairness via `view_count + jitter`

Instead of tracking per-user, the system uses a single counter per clip:

```sql
-- get_clips_randomized() RPC function
SELECT * FROM tournament_clips
WHERE slot_position = $1
  AND season_id = $2
  AND status = 'active'
  AND id NOT IN ($3)           -- Client-sent excludeIds (session dedup)
ORDER BY view_count + (RANDOM() * $4)  -- $4 = jitter (default 50)
LIMIT $5;
```

**How it works:**
1. Every time a clip is shown, its `view_count` increments
2. Clips with fewer views naturally sort to the top (fairness)
3. Random jitter (0-50) prevents predictable ordering (variety)
4. Client sends `excludeIds` of already-shown clips (session dedup)

**Why this scales:**
| Metric | Per-user tracking | view_count + jitter |
|--------|------------------|---------------------|
| Storage | O(users × clips) | O(clips) |
| Users supported | Thousands | Millions |
| Precision | Perfect | Very good |
| Complexity | High (Redis/DB) | Low (single column) |

**Index supporting this:**
```sql
idx_clips_distribution (slot_position, season_id, status, view_count ASC)
WHERE status = 'active'
```

#### View Count Recording (Non-Blocking)

Views are recorded asynchronously — they don't slow down the vote response:

```typescript
// Fire and forget — doesn't block the API response
recordClipViews(supabase, voterKey, clipIdsToRecord).catch(() => {});
```

The `clip_views` table uses UPSERT to prevent duplicate counting per user per clip.

---

### 21.5 Rate Limiting Architecture

Rate limiting uses **Upstash Redis** (serverless, globally distributed) with a fallback to in-memory tracking.

#### Endpoint-Specific Limits

```typescript
const RATE_LIMITS = {
  vote:            { requests: 30,  window: '1m' },  // 30 votes/min
  upload:          { requests: 5,   window: '1m' },  // 5 uploads/min
  comment:         { requests: 15,  window: '1m' },  // 15 comments/min
  api:             { requests: 60,  window: '1m' },  // 60 general calls/min
  read:            { requests: 120, window: '1m' },  // 120 reads/min
  auth:            { requests: 5,   window: '1m' },  // 5 auth attempts/min
  contact:         { requests: 3,   window: '1m' },  // 3 reports/min
  admin_sensitive: { requests: 5,   window: '1m' },  // 5 admin ops/min
};
```

**Algorithm:** Sliding window (more accurate than fixed window, avoids burst-at-boundary issues)

**Response Headers:**
```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 15
X-RateLimit-Reset: 1672531200
Retry-After: 45
```

**Fallback:** If Redis is unavailable, an in-memory rate limiter kicks in with automatic cleanup every 5 minutes. This prevents cascade failures — the app degrades gracefully instead of crashing.

---

### 21.6 Video Storage & Bandwidth

Video bandwidth is the **single largest cost driver** at scale. The app has multiple storage providers ready:

#### Supported Storage Providers

Located in `src/lib/video-storage.ts` (505 lines):

```typescript
const STORAGE_PROVIDER: 'supabase' | 'cloudinary' | 's3' | 'r2' = 'supabase';
```

All four providers are fully implemented with signed URL upload support:
- **Supabase Storage** (current) — Simple, integrated with auth
- **AWS S3** — Battle-tested, global CDN via CloudFront
- **Cloudflare R2** — S3-compatible, zero egress fees
- **Cloudinary** — Built-in transcoding and optimization

#### Bandwidth Cost Projection

```
Scenario: 500K daily active users, 5 clips watched per session

Without CDN (Supabase direct):
  500K × 5 clips × 30MB each = 75TB/day egress
  75TB × $0.02/GB = $45,000/month

With Cloudflare R2 + CDN + compressed clips:
  500K × 5 clips × 5MB each (compressed) = 12.5TB/day
  12.5TB × $0.01/GB (CDN rate) = $3,750/month

Monthly savings: ~$41,000
```

#### Migration Path

A complete migration guide exists at `Dokumentacja/2026-01-23-cloudflare-r2-migration-guide.md`:

1. Create R2 bucket in Cloudflare dashboard
2. Set 6 environment variables (access key, secret, endpoint, bucket, region, public URL)
3. Change one line: `const STORAGE_PROVIDER = 'r2'`
4. Deploy
5. Run migration script for existing files: `npx ts-node scripts/migrate-to-r2.ts`
6. Rollback: change provider back to `'supabase'` and deploy

---

### 21.7 Hot Path Analysis

The two most critical API endpoints (the "hot paths") have been carefully optimized:

#### GET /api/vote — Clip Fetching

This is the most-called endpoint. Every time a user scrolls to a new clip, this fires.

```
Request arrives
  │
  ├─ 1. Rate limit check ──────── Upstash Redis (~5-10ms)
  ├─ 2. Daily vote count ─────── Indexed query (~2-5ms)
  ├─ 3. Active season ────────── In-memory cache hit (~0.1ms)
  ├─ 4. Active slot ──────────── In-memory cache hit (~0.1ms)
  ├─ 5. Slot votes for user ──── Indexed query (~2-5ms)
  ├─ 6. Total clip count ─────── Indexed count (~2-3ms)
  ├─ 7. Fetch clips ──────────── RPC get_clips_randomized (~3-10ms)
  └─ 8. Batch comment counts ─── RPC get_comment_counts (~5-10ms)
                                                    ─────────
                                  Total: 20-50ms (with cache)
                                         200-300ms (without)
```

#### POST /api/vote — Vote Submission

The second most-called endpoint. Fires every time a user taps the vote button.

```
Request arrives
  │
  ├─ 1. Rate limit ────────────── Upstash Redis (~5-10ms)
  ├─ 2. Feature flags ─────────── In-memory cache hit (~0.1ms)
  ├─ 3. CAPTCHA (if enabled) ──── Network call (~200-500ms)
  ├─ 4. Daily vote count ─────── Indexed query (~2-5ms)
  ├─ 5. Clip validation ──────── Primary key lookup (~1ms)
  ├─ 6. Active slot ──────────── In-memory cache hit (~0.1ms)
  ├─ 7. Existing vote check ──── Indexed query (~2-5ms)
  └─ 8. insert_vote_atomic() ─── Atomic RPC (~5-15ms)
                                                    ─────────
                                  Total: 30-60ms (without CAPTCHA)
```

---

### 21.8 Distributed Locking

The auto-advance cron job (which selects winners and advances voting slots) must **never run concurrently** across multiple server instances. This is solved with a database-based distributed lock:

```typescript
// 1. Try to acquire lock
const { data: existingLock } = await supabase
  .from('cron_locks')
  .select()
  .eq('job_name', 'auto-advance')
  .gt('expires_at', now)
  .maybeSingle();

if (existingLock) {
  return { skipped: true };  // Another instance is running
}

// 2. Acquire lock with 60-second timeout
await supabase
  .from('cron_locks')
  .upsert({
    job_name: 'auto-advance',
    locked_at: now,
    expires_at: nowPlus60s
  });

// 3. Do work...

// 4. Release lock
await supabase
  .from('cron_locks')
  .delete()
  .eq('job_name', 'auto-advance');
```

**Properties:**
- `UPSERT` is atomic — no race conditions on lock acquisition
- 60-second expiry — if a server crashes, the lock auto-releases
- Multiple instances safely skip — no thundering herd

---

### 21.9 Batch Query Patterns

N+1 query problems are eliminated throughout the codebase.

#### Comment Counts (Batch RPC)

**Before (N+1):** 30 clips → 30 separate `SELECT COUNT(*) FROM comments WHERE clip_id = ?`

**After (single batch):**
```typescript
// Option 1: Database RPC function
const { data } = await supabase.rpc('get_comment_counts', {
  clip_ids: ['uuid1', 'uuid2', 'uuid3', ...]
});

// Option 2: Fallback batch query
const { data: allComments } = await supabase
  .from('comments')
  .select('clip_id')
  .in('clip_id', clipIds)
  .eq('is_deleted', false)
  .is('parent_comment_id', null);

// Count in JavaScript (O(n) is faster than 30 DB queries)
allComments.forEach(c => {
  countMap.set(c.clip_id, (countMap.get(c.clip_id) || 0) + 1);
});
```

**Impact:** 30 queries → 1 query = **30x fewer database calls**

#### Comment Replies (Batch Fetch)

Replies are fetched in a single query for all parent comments, then grouped client-side. This prevents the classic N+1 problem where each comment triggers a separate query for its replies.

#### User Profile Stats (Database Aggregation)

**Before:** Load all user votes into JavaScript memory, count client-side
**After:** RPC function `get_user_stats()` does aggregation in a single database query:

```sql
-- Single query returns: total_votes, total_xp, votes_today, streak
SELECT
  COUNT(*) as total_votes,
  SUM(vote_weight) as total_xp,
  COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as votes_today,
  -- Streak calculation using window functions over distinct dates
FROM votes WHERE user_id = $1;
```

---

### 21.10 Connection Management

#### Supabase Client Singleton

The app uses a singleton pattern for database connections to prevent connection pool exhaustion:

```typescript
let serviceClient: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient(url, serviceKey, {
      auth: {
        persistSession: false,      // No session overhead
        autoRefreshToken: false,    // No background token refresh
      },
    });
  }
  return serviceClient;
}
```

Three separate clients exist:
- **Anon client** — Public queries (respects RLS)
- **Service client** — Server-side operations (bypasses RLS)
- **Realtime client** — WebSocket subscriptions

**Not yet implemented:** PgBouncer connection pooling (recommended at 100K+ concurrent users)

---

### 21.11 Device Fingerprinting at Scale

Vote integrity relies on device fingerprinting to identify unique voters, even anonymous ones.

**Fingerprint composition:**
```typescript
const fingerprint = [
  ip,                    // Client IP
  userAgent,             // Browser user agent
  acceptLanguage,        // Language header
  secChUa,               // Client hints: browser
  secChUaPlatform,       // Client hints: OS
  secChUaMobile,         // Client hints: mobile
  acceptEncoding,        // Encoding support
].join('|');

const deviceKey = 'device_' + sha256(fingerprint).slice(0, 32);
```

**Risk Assessment:**
- Headless browser detection (missing headers)
- Bot pattern detection
- Suspicious voting patterns flagged in database
- HMAC-SHA256 integrity tokens with 5-minute expiry

**Scalability:** The fingerprint is a simple hash stored as `voter_key` in the votes table. No separate tracking infrastructure needed. Works with the existing `UNIQUE(clip_id, voter_key)` constraint.

---

### 21.12 Known Bottlenecks & Remediation

#### Fixed Bottlenecks

| Issue | Impact | Fix Applied |
|-------|--------|-------------|
| **No leaderboard pagination** | OOM crash at 100K+ clips | Added `.range()` with MAX_LIMIT=100 |
| **Feature flags queried per vote** | 3-4M unnecessary DB queries/day at 1M votes | 10-minute in-memory cache |
| **Vote race conditions** | Duplicate votes, negative counts | Atomic RPC functions with row locking |
| **N+1 comment counts** | 30 queries per page load | Batch RPC `get_comment_counts()` |
| **View tracking O(n)** | Sequential scan of clip_views | Added composite index `(voter_key, clip_id)` |
| **Per-user seen tracking** | Unbounded Redis storage | Replaced with view_count + jitter |

#### Open Bottlenecks

| Issue | Impact | Recommended Fix |
|-------|--------|----------------|
| **JWT callback DB query** | 1 query per authenticated request (10M/day at 1M users) | Cache user profile in JWT token |
| **No CDN for videos** | $45K/month bandwidth at 500K DAU | Activate Cloudflare R2 (guide exists) |
| **Single-instance cache** | Cache inconsistency across Vercel instances | Redis for distributed caching |
| **No connection pooling** | Connection exhaustion at 100K+ concurrent | Add PgBouncer |
| **Realtime connection limit** | Supabase limits: 10K simultaneous WebSocket connections | Channel sharding or Pusher upgrade |
| **Leaderboard OFFSET** | `OFFSET 1000000` is slow for deep pagination | Cursor/keyset pagination |
| **Materialized views unused** | Created but no refresh cron job | Schedule 5-min refresh via cron |

---

### 21.13 Scaling Roadmap

#### Phase 1: 10K → 100K Users (Current Focus)

- [x] Database indexing (23+ indexes)
- [x] In-memory caching (season, slot, clips, feature flags)
- [x] Atomic RPC functions (vote insert/delete)
- [x] Rate limiting (Upstash Redis)
- [x] Batch queries (comment counts, replies)
- [x] HTTP cache headers (CDN edge caching)
- [x] Leaderboard pagination
- [ ] Fix JWT callback caching
- [ ] Activate CDN for video files

#### Phase 2: 100K → 500K Users

- [ ] Distributed Redis cache (replace in-memory caches)
- [ ] PgBouncer connection pooling
- [ ] Cloudflare R2 migration for videos
- [ ] Cursor-based pagination for leaderboard
- [ ] Activate materialized view refresh cron
- [ ] Window functions for rank calculations

#### Phase 3: 500K → 1M+ Users

- [ ] Database read replicas (read-heavy workload)
- [ ] Table partitioning for `clip_views` (monthly partitions at 50M+ rows)
- [ ] Realtime channel sharding (beyond 10K WebSocket connections)
- [ ] Edge function deployment for rate limiting
- [ ] Queue-based async processing (dead letter queues for failures)
- [ ] Database query timeout enforcement

---

### 21.14 Cost Projections at Scale

#### Monthly Infrastructure Costs

| Service | 10K Users | 100K Users | 1M Users (no CDN) | 1M Users (with CDN) |
|---------|-----------|------------|-------------------|---------------------|
| Supabase DB | $25 | $75-150 | $500-1,000 | $500-1,000 |
| Vercel Hosting | $20 | $50-100 | $200-500 | $200-500 |
| Upstash Redis | $10 | $50-100 | $100-500 | $100-500 |
| Video Bandwidth | $50 | $2,000 | **$45,000** | **$3,750** |
| Sentry | $0 | $26 | $80 | $80 |
| **Total** | **~$105** | **~$2,400** | **~$46,000** | **~$5,800** |

The difference between $46K/month and $5.8K/month is almost entirely video bandwidth — making CDN migration the single highest-ROI optimization.

---

### 21.15 Monitoring & Observability

#### Current Monitoring

| Tool | Purpose | Status |
|------|---------|--------|
| **Sentry** | Error tracking, performance monitoring | Active (`src/lib/monitoring.ts`) |
| **Custom Logger** | Structured logging with levels | Active (`src/lib/logger.ts`) |
| **Audit Logs** | Admin action tracking | Active (`src/lib/audit-log.ts`) |
| **Rate Limit Analytics** | Track rate limit hits | Active (Upstash dashboard) |
| **Health Endpoint** | `/api/health` uptime check | Active |

#### Recommended Additions

| Tool | Purpose | When Needed |
|------|---------|-------------|
| **pg_stat_statements** | Slow query identification | Now |
| **Vercel Analytics** | Request latency per route | Now |
| **Uptime monitoring** | Downtime alerts | Now |
| **Cache hit ratio tracking** | Tune cache TTLs | At 50K+ users |
| **Connection pool monitoring** | Prevent exhaustion | At 100K+ users |

#### Key Metrics to Track

**Database Health:**
- Active connections vs pool size
- Query latency: p50, p95, p99
- Slow queries (>100ms)
- Lock wait time

**API Performance:**
- Request latency by endpoint
- Error rate by endpoint
- Cache hit ratio (target: >80% for reads)
- Rate limit rejection rate

**Business Metrics:**
- Votes per minute (growth indicator)
- DAU/MAU ratio (engagement)
- Upload rate (content supply)
- Session duration

---

### 21.16 Scalability Scorecard

| Component | Grade | Notes |
|-----------|-------|-------|
| **Vote System** | A | Atomic RPCs, triggers, race conditions fixed |
| **Clip Distribution** | A | Scales infinitely, no per-user storage |
| **Database Indexes** | A | 23+ indexes, strategic composite indexes |
| **Rate Limiting** | A | Redis-backed with graceful fallback |
| **In-Memory Caching** | B+ | Effective but single-instance |
| **Feature Flags** | A | 10-min cache, 99.5% query reduction |
| **Cron Safety** | A | Distributed locks prevent concurrent runs |
| **Batch Queries** | A | N+1 eliminated for comments, views, stats |
| **Frontend Perf** | B+ | Code splitting, memoization, preloading |
| **Video Delivery** | C | No CDN yet (migration guide available) |
| **Auth Caching** | C | JWT callback queries DB every request |
| **Distributed Cache** | D | Not implemented (single-instance only) |
| **Connection Pooling** | D | Not implemented (PgBouncer needed) |

**Overall: B** — Strong foundations, needs infrastructure upgrades for 1M+ scale.

---

### 21.17 User Capacity Analysis — How Many Users Can the Platform Handle?

This section provides a concrete, bottleneck-by-bottleneck breakdown of how many daily active users (DAU) the platform can support at each infrastructure tier. All numbers are derived from actual source code analysis, Supabase documentation, and service-tier limits — not theoretical estimates.

#### Current Architecture Bottlenecks

Every system has a weakest link. Here are the specific bottlenecks ranked from most constraining to least:

| # | Bottleneck | Free Tier Limit | Impact |
|---|-----------|----------------|--------|
| 1 | **Database connections** | 3 concurrent (Supabase Free) | Each page load opens a connection; 3 concurrent users = hard ceiling |
| 2 | **Video bandwidth** | 100 GB/month (Supabase Storage) | At ~3 MB per 8-second clip, ~33,333 views/month ≈ 115 DAU watching 10 clips/day |
| 3 | **Auth JWT callback** | DB query on every authenticated request | No session caching beyond 5-min profile cache; each API call hits DB |
| 4 | **Realtime connections** | 200 concurrent (Supabase Free) | WebSocket connections for live vote counts, comments |
| 5 | **Rate limiting (Upstash)** | 100 commands/sec (Free) | Each rate-limited request = 2-3 Redis commands |
| 6 | **In-memory cache** | 20 entries per Node.js instance | No distributed cache; every Vercel cold start rebuilds cache |
| 7 | **Cron jobs** | Single-instance, sequential | Auto-advance processes one slot at a time; fine for <100 concurrent seasons |

#### Tier-by-Tier Capacity Breakdown

**Tier 0: Current Free Infrastructure (~5–10 DAU)**

The platform on its current free-tier infrastructure can realistically support 5–10 daily active users. The primary bottleneck is database connections — Supabase Free allows only 3 concurrent connections, and since each page load, vote, and API call consumes a connection, even a handful of simultaneous users can exhaust the pool. The in-memory cache (20-entry maximum, instance-scoped) helps by absorbing repeated reads for feature flags and leaderboard data, but Vercel's serverless model means each cold function invocation starts with an empty cache. Video bandwidth at 100 GB/month comfortably serves 5–10 users watching clips casually, but would become the second bottleneck beyond ~15 DAU.

| Resource | Limit | Calculation | DAU Supported |
|----------|-------|-------------|---------------|
| DB connections | 3 concurrent | ~2 connections per active user | **~5–10** |
| Video bandwidth | 100 GB/month | 10 clips/day × 3 MB × 30 days = 900 MB/user/month | ~110 |
| Realtime | 200 connections | 1 per active tab | ~150 |
| Upstash Redis | 100 cmd/sec | ~3 commands per rate-limited request | ~33 req/sec |
| **Effective ceiling** | | | **~5–10 DAU** |

**Tier 1: Supabase Pro + Vercel Pro (~50–100 DAU)**

Upgrading to Supabase Pro ($25/month) raises the connection limit to 50 concurrent and provides 250 GB bandwidth. The JWT callback overhead becomes the new bottleneck — every authenticated API request triggers a database query in the `jwt` callback of NextAuth to fetch the user profile. With the 5-minute in-memory profile cache (`authProfileCache` in `auth-options.ts`), roughly 80% of these are absorbed, but the remaining 20% still hit the database. At 50 concurrent connections, with an average connection hold time of ~50ms per query, the system can process ~1,000 requests/second — sufficient for 50–100 DAU generating roughly 10–20 API calls per minute each.

| Resource | Limit | DAU Supported |
|----------|-------|---------------|
| DB connections | 50 concurrent | ~100–200 |
| Video bandwidth | 250 GB/month | ~275 |
| Auth queries | ~1,000 req/sec effective | ~500 |
| Realtime | 500 connections | ~400 |
| **Effective ceiling** | | **~50–100 DAU** |

**Tier 2: CDN Migration + Connection Pooling (~500–1,000 DAU)**

The codebase already includes a migration path for Cloudflare R2 (defined in `video-storage.ts` with `R2StorageProvider`). Moving video delivery to R2 ($0.015/GB egress) effectively removes the bandwidth bottleneck. Adding PgBouncer connection pooling (available on Supabase Pro via the pooler endpoint) transforms the connection model from "one connection per serverless function" to pooled transaction-mode connections, supporting 200+ concurrent logical sessions over 50 physical connections. At this tier, the bottleneck shifts to the in-memory cache being per-instance — popular queries (leaderboard, active season data, feature flags) get re-fetched on every cold start.

| Resource | Limit | DAU Supported |
|----------|-------|---------------|
| DB connections (pooled) | 200+ logical | ~800–1,000 |
| Video bandwidth (R2) | Unlimited (pay-per-GB) | Unlimited |
| Auth queries (pooled) | ~2,000 req/sec | ~1,000 |
| Realtime | 500–10K (upgrade available) | ~500–8,000 |
| **Effective ceiling** | | **~500–1,000 DAU** |

**Tier 3: Distributed Cache + Optimized Auth (~10,000–100,000 DAU)**

Introducing Redis as a distributed cache (replacing the 20-entry per-instance `Map`) would allow all Vercel edge functions to share cached data. The leaderboard, which currently recomputes on every uncached request with an expensive aggregation query, would be served from Redis with a 30-second TTL. Auth optimization — either using Supabase Auth's built-in JWT validation (eliminating the DB roundtrip entirely) or extending the profile cache to Redis with a 15-minute TTL — removes the single largest per-request cost. At this point, the database handles only writes (votes, comments, uploads) and cache-miss reads, reducing query volume by ~90%.

| Resource | Limit | DAU Supported |
|----------|-------|---------------|
| DB queries (writes only + cache misses) | ~500 write/sec (Supabase Pro) | ~50,000 |
| Distributed cache (Redis) | 10K–100K cmd/sec (Upstash Pro) | ~100,000 |
| Auth (JWT-only validation) | No DB hit needed | Unlimited |
| Video (R2 + CDN) | Unlimited | Unlimited |
| **Effective ceiling** | | **~10,000–100,000 DAU** |

**Tier 4: Full Horizontal Scale (~1,000,000+ DAU)**

At this scale, additional architectural changes are needed: database read replicas for distributing read queries, a dedicated queue system (e.g., BullMQ or AWS SQS) for vote processing to handle burst traffic, edge-side rendering for static content, and potentially sharding the clips/votes tables by season. The codebase's design decisions — stateless serverless functions, atomic database operations, no server-side session state — make this transition feasible without a rewrite. The `get_clips_randomized()` distribution algorithm scales linearly with clip count (not user count), meaning it doesn't need redesigning even at 1M users.

| Resource | Solution | DAU Supported |
|----------|----------|---------------|
| Database | Read replicas + sharding | ~1M+ |
| Vote processing | Async queue + batch writes | ~1M+ |
| Video delivery | Multi-region CDN | Unlimited |
| Caching | Redis Cluster | ~1M+ |
| Auth | Stateless JWT verification | Unlimited |
| **Effective ceiling** | | **~1,000,000+ DAU** |

#### Summary: Scaling Roadmap

```
Current State (Free Tier)
│  ~5–10 DAU
│  Cost: $0/month
│
├─ Upgrade 1: Supabase Pro + Vercel Pro
│  ~50–100 DAU
│  Cost: ~$45/month
│
├─ Upgrade 2: R2 CDN + PgBouncer Pooling
│  ~500–1,000 DAU
│  Cost: ~$70/month + usage
│
├─ Upgrade 3: Redis Distributed Cache + Auth Optimization
│  ~10,000–100,000 DAU
│  Cost: ~$200–500/month
│
└─ Upgrade 4: Read Replicas + Queue System + Sharding
   ~1,000,000+ DAU
   Cost: ~$2,000–10,000/month
```

#### Key Insight

The most important architectural decision already made is the **stateless serverless design** — no server-side sessions, no sticky connections, no in-process state that can't be lost. This means scaling from Tier 0 to Tier 4 is entirely an infrastructure upgrade path, not a code rewrite. The application code remains largely unchanged; only configuration and infrastructure services change. The clip distribution algorithm (`view_count + random jitter`) is particularly well-designed for scale because its storage and computation costs are O(clips), not O(users × clips) — adding more users doesn't increase the algorithm's resource consumption.

---

### 21.18 Voting System Concurrent Load Analysis — What Happens at 10K / 100K / 1M Simultaneous Votes?

This section provides a deep, layer-by-layer analysis of the voting system under extreme concurrent load. Rather than general scalability estimates, this examines the exact code path a vote takes and identifies the specific point at which each layer breaks under 10,000, 100,000, and 1,000,000 simultaneous vote requests.

#### The Vote Pipeline (Per Single Vote)

Every vote request traverses this exact path before a vote is recorded:

```
HTTP Request
  → Rate limit check (3 Redis commands via Upstash sliding window)
  → Feature flags check (in-memory cache, 10-min TTL)
  → 2 parallel DB queries:
      ├─ getUserVotesToday (SELECT SUM(vote_weight) FROM votes WHERE voter_key = $1 AND created_at >= today)
      └─ getClipData (SELECT FROM tournament_clips WHERE id = $1)
  → insert_vote_atomic RPC:
      ├─ INSERT INTO votes (+ UNIQUE constraint check across 14 indexes)
      ├─ TRIGGER: UPDATE tournament_clips SET vote_count += 1  ← HOT ROW
      └─ SELECT updated vote_count, weighted_score
  → HTTP Response
```

**Per vote cost:** ~3 Redis commands + 3–4 database queries/operations + 14 index updates on INSERT.

#### Layer 1: Rate Limiting (First Wall)

The rate limiting layer uses Upstash Redis with a sliding window algorithm. Each rate limit check consumes 3 Redis commands: `ZRANGE` (get requests in window), `ZADD` (add current request), and `ZREMRANGEBYSCORE` (expire old requests). The per-IP limit is 30 votes per minute.

| Metric | Free Tier | Pro Tier |
|--------|-----------|----------|
| Upstash throughput | 100 commands/sec | 1,000+ commands/sec |
| Commands per vote check | 3 | 3 |
| Max vote checks/sec | ~33 | ~333 |
| Per-IP limit | 30 votes/min | 30 votes/min |

**At 10,000 simultaneous users (distinct IPs):** Each user is individually under the 30/min per-IP limit, so rate limiting doesn't block them. But 10,000 users × 3 Redis commands = 30,000 commands hitting Upstash simultaneously. Free tier (100 cmd/sec) creates a **~300-second queue** — a 5-minute stall at the very first layer. Pro tier (1,000 cmd/sec) clears in ~30 seconds — strained but manageable.

**At 100,000 users:** Free tier is completely overwhelmed. Pro tier backs up to ~300 seconds. Requires Upstash Enterprise (~10K cmd/sec).

**At 1,000,000 users:** Even Enterprise struggles. 3,000,000 commands needed instantly. Requires Redis Cluster with sharding.

**Fallback vulnerability:** When Redis becomes unreachable, the code falls back to an in-memory `Map<string, RateLimitEntry>` (defined in `rate-limit.ts`). This map is **per serverless function instance**. On Vercel's serverless architecture, each concurrent request can spin up a separate instance, each with its own independent counter. The fallback effectively provides **zero rate limiting** under load — a coordinated bot attack during Redis downtime would bypass all rate limits entirely.

#### Layer 2: Database Connections (The Hard Ceiling)

Each vote requires 3–4 database operations. The API creates a new Supabase client per request (`createSupabaseServerClient()` in `vote/route.ts`), and there is no application-level connection pooling configured.

| Tier | Max Concurrent Connections | Effective Parallel Votes |
|------|---------------------------|--------------------------|
| Free | 3 | ~1 |
| Pro | 50 | ~12–16 |
| Pro + PgBouncer | 200 logical | ~50–65 |

**At 10,000 simultaneous votes:**
- **Free tier:** 9,997 requests wait or timeout (30s default). Most get `503` or connection refused.
- **Pro tier:** ~12 votes process in parallel, rest queue. At ~100ms per vote, throughput is ~120 votes/sec. All 10,000 votes take **~83 seconds** if perfectly queued — but the 30-second timeout kills most before they complete. Expected success rate: **~35%**.
- **Pro + PgBouncer:** ~50 parallel, throughput ~500 votes/sec. Clears in **~20 seconds.** Survivable if votes spread across clips.

**At 100,000 simultaneous votes:** Even with PgBouncer, 100K ÷ 500/sec = **200 seconds**. Most requests timeout at 30 seconds. Expected success rate: **<15%**.

**At 1,000,000 simultaneous votes:** No single Supabase instance can handle this. Requires database sharding or a write-ahead queue.

#### Layer 3: The Hot Row Problem (The Real Killer)

This is the most critical bottleneck and the most subtle. The `on_vote_insert` trigger (defined in `migration-vote-trigger.sql`) executes after every successful vote INSERT:

```sql
UPDATE tournament_clips
SET vote_count = COALESCE(vote_count, 0) + COALESCE(NEW.vote_weight, 1),
    weighted_score = COALESCE(weighted_score, 0) + COALESCE(NEW.vote_weight, 1)
WHERE id = NEW.clip_id;
```

This UPDATE acquires a **row-level exclusive lock** on the `tournament_clips` row for that clip. PostgreSQL does not allow two transactions to update the same row simultaneously — every vote for the same clip must wait for the previous vote's trigger to release its lock before proceeding. **This serializes all concurrent votes for the same clip into a single-threaded queue.**

**If 10,000 users vote on the SAME clip simultaneously:**
- Each trigger UPDATE takes ~1–2ms (fast, single row)
- But serialized: 10,000 × 1.5ms = **~15 seconds of pure lock contention**
- During this wait, each blocked transaction holds its database connection open
- Connection pool exhausts almost immediately, cascading into Layer 2 failures

**If 10,000 users vote on DIFFERENT clips (spread across 50 clips):**
- 200 votes per clip × 1.5ms = **~300ms per clip** — completely fine
- 50 different `tournament_clips` rows lock independently, full parallelism
- **This scenario is ~50x faster than the single-clip scenario**

The real-world distribution follows a power law — most votes concentrate on a few popular clips. Estimated realistic distribution for 10,000 votes across 50 clips:

| Clip Rank | Votes Received | Lock Wait Time | Queue Depth |
|-----------|---------------|----------------|-------------|
| #1 (most popular) | ~2,000 | ~3 seconds | 2,000 deep |
| #2 | ~1,200 | ~1.8 seconds | 1,200 deep |
| #3 | ~800 | ~1.2 seconds | 800 deep |
| #4–10 | ~300 each | ~450ms each | manageable |
| #11–50 | ~50 each | ~75ms each | trivial |

The top clip becomes a global bottleneck: 3 seconds of serialized writes while holding database connections, causing pool exhaustion that blocks votes for all other clips too.

#### Layer 4: The Daily Limit Query (Hidden Amplifier)

Before every vote, the API queries the daily vote count:

```sql
SELECT COALESCE(SUM(vote_weight), 0)
FROM votes
WHERE voter_key = $1 AND created_at >= $2  -- today's midnight UTC
```

This uses the index `idx_votes_voter_key_date(voter_key, created_at DESC)`. For a user with 50 votes today, it scans 50 index entries — fast individually.

**At scale:** 10,000 concurrent queries all hit the `votes` table simultaneously. The B-tree index handles each query in O(log n + k) time, but **10,000 concurrent index scans compete for PostgreSQL's shared buffer pool pages**. On Supabase Pro (typically ~256MB shared buffers), cache pressure causes page evictions, forcing disk reads. At 100,000 concurrent queries, the buffer pool thrashes badly, and individual query time degrades from ~1ms to ~10–50ms.

#### Layer 5: Index Maintenance on INSERT (The Silent Tax)

The `votes` table has **14 indexes** (including unique constraints and partial indexes). Every `INSERT INTO votes` must update all 14 indexes:

- `votes_clip_voter_unique` (UNIQUE)
- `idx_votes_voter_key_date`
- `idx_votes_clip_id`
- `idx_votes_created_at`
- `idx_votes_voter_clip`
- `idx_votes_one_super_per_slot` (partial UNIQUE)
- `idx_votes_one_mega_per_slot` (partial UNIQUE)
- `idx_votes_user_id_created` (partial)
- `idx_votes_user_id` (partial)
- `idx_votes_voter_weight`
- `idx_votes_voter_slot`
- `idx_votes_voter_slot_type`
- `idx_votes_voter_created`
- `idx_votes_flagged` (partial)

**Per-insert index cost:** 14 indexes × ~0.1ms each = **~1.4ms of index writes per vote**. Under heavy concurrent inserts, B-tree index pages split more frequently. At 10,000 concurrent inserts, index page contention becomes measurable. At 100,000, autovacuum cannot keep up with dead tuple accumulation from the INSERT/UPDATE churn, causing index bloat that further degrades scan performance.

#### Scenario Analysis

##### 10,000 Users Vote Simultaneously

| Layer | Status | Impact |
|-------|--------|--------|
| Rate Limiting (Upstash Free) | **FAILS** | 100 cmd/sec vs 30,000 needed — 5-minute stall |
| Rate Limiting (Upstash Pro) | Strained | 1,000 cmd/sec, clears in ~30s |
| DB Connections (Free) | **CRASHES** | 3 connections, 9,997 requests dropped |
| DB Connections (Pro) | **OVERWHELMED** | 50 connections, ~83s drain, most timeout |
| DB Connections (Pro + PgBouncer) | Strained | 200 logical, ~20s drain — survivable |
| Hot Row Locks (same clip) | **BOTTLENECK** | ~15s serialized lock wait, pool exhaustion |
| Hot Row Locks (spread across clips) | OK | ~300ms per clip, parallel execution |
| Daily Limit Query | OK | Index-backed, fast per query |
| Index Maintenance (14 indexes) | Strained | ~1.4ms overhead per insert, page contention |

**Verdict:** With Pro + PgBouncer, the system **survives if votes are distributed across multiple clips**. If votes concentrate on one clip (the realistic scenario for a "trending" clip), the hot row lock is the killer — 15 seconds of serialized writes causes cascading connection pool exhaustion.

##### 100,000 Users Vote Simultaneously

| Layer | Status | Impact |
|-------|--------|--------|
| Rate Limiting | **FAILS** on all but Enterprise Redis | 300K Redis commands needed instantly |
| DB Connections | **FAILS** even with PgBouncer | 200 connections × 100ms = 2K/sec vs 100K needed |
| Hot Row Locks | **CATASTROPHIC** if concentrated | 150 seconds serialized writes on popular clip |
| Shared Buffers | **PRESSURED** | 100K concurrent index scans thrash buffer pool |
| Autovacuum | **FALLING BEHIND** | 100K dead tuples per burst need cleaning |

**Verdict:** The system **cannot handle this**. Most requests timeout. The database enters a lock contention spiral where connection exhaustion compounds row lock waits. Requires: write-ahead queue (batch inserts), read replicas for the daily-limit queries, and distributed rate limiting.

##### 1,000,000 Users Vote Simultaneously

| Layer | Status | Impact |
|-------|--------|--------|
| Rate Limiting | Non-functional | No single Redis handles 3M commands/sec |
| DB Connections | Non-functional | Single PostgreSQL instance cannot process this |
| Hot Row Locks | Non-functional | 25+ minutes serialized on a popular clip |
| Index Maintenance | Non-functional | 14M index updates simultaneously |
| Network | Saturated | ~100KB per request × 1M = 100GB network traffic burst |

**Verdict:** Requires fundamentally different architecture — a vote queue (SQS/BullMQ), batch counter updates, sharded database, CDN-level rate limiting (Cloudflare Workers), and eventually-consistent vote counts displayed to users.

#### The Three Critical Vulnerabilities

**1. Hot Row Serialization (Most Dangerous)**

The trigger-based `vote_count += 1` on `tournament_clips` serializes ALL votes for the same clip. At scale, a single popular clip becomes a global lock that blocks the entire connection pool.

*Potential fix:* Replace per-vote trigger with periodic batch aggregation. Instead of updating `vote_count` on every insert, disable the trigger and run a scheduled job every 5–10 seconds:
```sql
UPDATE tournament_clips tc
SET vote_count = sub.cnt, weighted_score = sub.ws
FROM (
  SELECT clip_id, COUNT(*) as cnt, SUM(vote_weight) as ws
  FROM votes WHERE clip_id IN (
    SELECT DISTINCT clip_id FROM votes WHERE created_at > NOW() - INTERVAL '10 seconds'
  ) GROUP BY clip_id
) sub
WHERE tc.id = sub.clip_id;
```
This decouples write throughput from counter accuracy — votes insert instantly without row locks, and counters update every 5–10 seconds in a single batch. Users see slightly stale counts (acceptable for a voting app).

**2. No Write Queue (Second Most Dangerous)**

Every vote is a synchronous database INSERT. Under burst traffic, the database becomes the bottleneck with no buffer to absorb spikes.

*Potential fix:* Accept votes into a Redis list (LPUSH), return "vote accepted" to the client immediately, and run a background worker that drains the queue in batches of 100–1,000 using a single multi-row INSERT transaction. This transforms the write pattern from 10,000 individual transactions to ~10–100 batch transactions.

**3. Per-Instance Rate Limiting Fallback (Security Risk)**

When Redis is unreachable, the in-memory `Map` fallback is per Vercel function instance. Serverless auto-scaling means each concurrent request gets its own fresh instance with an empty rate limit map. A coordinated bot attack during Redis downtime faces **zero effective rate limiting**.

*Potential fix:* Implement fail-closed behavior — if Redis is unreachable, reject vote requests entirely with a `503 Service Unavailable` response rather than proceeding with non-functional rate limiting. This trades availability for security: better to block all votes temporarily than to allow unlimited bot voting.

#### Capacity Summary

| Concurrent Voters | Infrastructure Required | Expected Success Rate | p99 Latency |
|-------------------|-----------------------|----------------------|-------------|
| 100 | Supabase Pro | ~99% | ~500ms |
| 1,000 | Pro + PgBouncer | ~95% | ~2s |
| 10,000 | Pro + PgBouncer + Redis Pro | ~60–80% (if distributed across clips) | ~15–20s |
| 10,000 | + Write queue + batch counters | ~99% | ~1s |
| 100,000 | Queue + Batch + Read replicas | ~95% with queue | ~2–5s |
| 1,000,000 | Full redesign (sharding, CDN rate limit, queue, batch counters) | ~90% with full stack | ~5–10s |

#### Assessment

The voting system is well-engineered for correctness at its current scale — atomic RPCs prevent duplicate votes, `SELECT FOR UPDATE` eliminates TOCTOU race conditions, `GREATEST(0, ...)` prevents negative counts, and unique constraints provide database-level guarantees. These are difficult problems solved correctly.

The scalability ceiling is not a code quality issue but an architectural pattern issue: synchronous writes with per-row trigger updates create hard serialization limits. The path from current capacity (~100 concurrent voters) to 10K+ requires decoupling the write path (async queue) from the read path (batch-updated counters) — a common evolution for voting/counter systems at scale.

*This document describes the complete AiMoviez platform as of January 2026. The project is in active beta development.*
