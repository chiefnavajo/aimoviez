# ðŸ” AiMoviez Complete Scenario Testing Matrix

**Last Updated:** 2024
**Purpose:** Comprehensive testing of all user scenarios, edge cases, and system states

---

## ðŸ“± USER JOURNEY SCENARIOS

### Scenario 1: First-Time User
**Path:** Landing â†’ Story Page â†’ Onboarding â†’ Voting Arena

#### Test Steps:
- [ ] 1.1 Open app URL for first time
- [ ] 1.2 Verify localStorage does NOT have `hasVisited` key
- [ ] 1.3 Should redirect to `/story` page
- [ ] 1.4 Verify Story page loads with:
  - [ ] Infinity logo animation
  - [ ] Hero section with Season info
  - [ ] "Go to Voting Arena" CTA button
  - [ ] 75 slot grid (3 columns on mobile)
  - [ ] Genre voting section (7 tiles)
  - [ ] Bottom navigation (4 tabs)
- [ ] 1.5 Click "Go to Voting Arena" button
- [ ] 1.6 Should navigate to `/dashboard`
- [ ] 1.7 Verify Voting Arena loads with:
  - [ ] Full-screen clip interface
  - [ ] Video/thumbnail display
  - [ ] âˆž vote button at bottom
  - [ ] Daily progress sphere (top-left)
  - [ ] "Slot X/75" indicator (top-center)
  - [ ] Creator info (bottom-left)
  - [ ] Comments/Share buttons (right side)

**Expected Result:** âœ… Smooth onboarding flow, all UI elements render correctly

**Potential Issues:**
- âš ï¸ localStorage not available (incognito mode)
- âš ï¸ Redirect loop if routing logic conflicts
- âš ï¸ Missing components cause blank screens

---

### Scenario 2: Returning User (Same Device)
**Path:** Landing â†’ Auto-redirect to Dashboard

#### Test Steps:
- [ ] 2.1 Refresh browser or reopen app
- [ ] 2.2 Verify localStorage HAS `hasVisited = true`
- [ ] 2.3 Should AUTO-REDIRECT to `/dashboard`
- [ ] 2.4 Should NOT show Story page again
- [ ] 2.5 Voting Arena loads immediately

**Expected Result:** âœ… Direct access to Voting Arena

**Potential Issues:**
- âš ï¸ localStorage cleared â†’ treated as first-time user
- âš ï¸ Auto-redirect doesn't fire
- âš ï¸ Infinite redirect loop

---

### Scenario 3: User Votes Within Daily Limit
**Path:** Dashboard â†’ Watch Clip â†’ Vote â†’ See Next Clip

#### Test Steps:
- [ ] 3.1 Land on `/dashboard` with clips loaded
- [ ] 3.2 Verify `remainingVotes.standard` > 0
- [ ] 3.3 Verify `localVotesToday` < 200
- [ ] 3.4 Tap âˆž vote button
- [ ] 3.5 Check mutations:
  - [ ] POST `/api/vote` request sent
  - [ ] Body contains: `{ clipId, voteType: 'standard' }`
  - [ ] Response: `{ success: true, newScore, totalVotesToday, remainingVotes }`
- [ ] 3.6 Verify UI updates:
  - [ ] Vote count increments on clip
  - [ ] Progress sphere fills slightly
  - [ ] `localVotesToday` increases by 1
  - [ ] Toast notification shows "âœ… Vote counted!"
  - [ ] Haptic feedback vibrates (if supported)
  - [ ] Confetti animation at milestones (1st, 50th, 200th vote)
- [ ] 3.7 Verify clip advances to next automatically
- [ ] 3.8 Repeat 10 times
- [ ] 3.9 Verify all votes persist

**Expected Result:** âœ… Smooth voting experience, all UI feedback works

**Potential Issues:**
- âš ï¸ Double-tap vote button â†’ duplicate votes (isVoting flag should prevent)
- âš ï¸ Optimistic update fails â†’ UI shows wrong count
- âš ï¸ Network error â†’ vote not recorded but UI updates
- âš ï¸ localVotesToday doesn't sync with backend totalVotesToday

---

### Scenario 4: User Hits Daily Limit (200 Votes)
**Path:** Dashboard â†’ Vote 200 times â†’ Limit Reached

#### Test Steps:
- [ ] 4.1 Start with `localVotesToday = 195`
- [ ] 4.2 Cast 5 more votes (total = 200)
- [ ] 4.3 On 200th vote:
  - [ ] Check response: `remainingVotes = 0`
  - [ ] Progress sphere fills to 100%
  - [ ] Special confetti animation
  - [ ] Toast: "ðŸŽ‰ Daily goal reached! You're on fire!"
- [ ] 4.4 Try to vote again (201st attempt)
- [ ] 4.5 Check POST `/api/vote` response:
  - [ ] `{ success: false, error: "Daily vote limit reached" }`
- [ ] 4.6 Verify UI shows:
  - [ ] âˆž button disabled or grayed out
  - [ ] Toast error: "Daily limit reached (200/200)"
  - [ ] Message: "Come back tomorrow!"

**Expected Result:** âœ… Limit enforced, clear feedback to user

**Potential Issues:**
- âš ï¸ Frontend allows 201st vote (limit check bypassed)
- âš ï¸ Backend limit (200) doesn't match frontend constant
- âš ï¸ User can vote by manually calling API
- âš ï¸ No visual indication that limit is reached

---

### Scenario 5: User Swipes Through Clips
**Path:** Dashboard â†’ Swipe Up â†’ Next Clip / Swipe Down â†’ Previous Clip

#### Test Steps:
- [ ] 5.1 Start at clip index 0
- [ ] 5.2 Swipe UP (touchStartY > touchEndY by 50px+)
- [ ] 5.3 Verify:
  - [ ] `activeIndex` increments to 1
  - [ ] New clip loads
  - [ ] Video/thumbnail changes
  - [ ] Creator info updates
- [ ] 5.4 Swipe DOWN (touchEndY > touchStartY by 50px+)
- [ ] 5.5 Verify:
  - [ ] `activeIndex` decrements to 0
  - [ ] Returns to previous clip
- [ ] 5.6 At last clip (index = clips.length - 1), swipe UP
- [ ] 5.7 Verify: Loops to clip index 0
- [ ] 5.8 At first clip (index = 0), swipe DOWN
- [ ] 5.9 Verify: Stays at 0 (or loops to last clip if logic allows)

**Expected Result:** âœ… Smooth swipe navigation, no crashes

**Potential Issues:**
- âš ï¸ Swipe threshold too sensitive/insensitive
- âš ï¸ Swipe works when comments are open (should be disabled)
- âš ï¸ Index out of bounds error
- âš ï¸ Clip doesn't change visually

---

### Scenario 6: User Opens Comments Overlay
**Path:** Dashboard â†’ Tap Comments Button â†’ View/Add Comments

#### Test Steps:
- [ ] 6.1 Tap comments button (speech bubble icon)
- [ ] 6.2 Verify `showComments = true`
- [ ] 6.3 Check UI changes:
  - [ ] Video scales down and moves up
  - [ ] Comments panel slides up from bottom
  - [ ] Shows existing comments (mock data)
  - [ ] Input box for new comment
  - [ ] "Send" button
- [ ] 6.4 Try to swipe â†’ Should NOT change clips
- [ ] 6.5 Type comment in input
- [ ] 6.6 Click "Send"
- [ ] 6.7 Verify:
  - [ ] Comment added to list (currently local, not saved)
  - [ ] Input cleared
- [ ] 6.8 Close comments (tap backdrop or X button)
- [ ] 6.9 Verify `showComments = false`
- [ ] 6.10 Video returns to full-screen

**Expected Result:** âœ… Comments UI works, swipe disabled while open

**Potential Issues:**
- âš ï¸ Swipe still works with comments open
- âš ï¸ Comments don't save (expected for now - mock data)
- âš ï¸ Can't close comments overlay
- âš ï¸ Video doesn't resize correctly

---

### Scenario 7: User Navigates Between Pages
**Path:** Dashboard â†’ Story â†’ Upload â†’ Profile â†’ Back to Dashboard

#### Test Steps:
- [ ] 7.1 On `/dashboard`, verify "Shorts" tab highlighted (cyan)
- [ ] 7.2 Tap "Story" tab
- [ ] 7.3 Navigate to `/story`
- [ ] 7.4 Verify Story tab highlighted
- [ ] 7.5 Tap "Upload" tab
- [ ] 7.6 Navigate to `/upload`
- [ ] 7.7 Verify Upload wizard loads
- [ ] 7.8 Tap "Profile" tab
- [ ] 7.9 Navigate to `/profile`
- [ ] 7.10 Verify user stats load
- [ ] 7.11 Tap "Shorts" tab
- [ ] 7.12 Return to `/dashboard`
- [ ] 7.13 Verify voting state preserved (same clip index)

**Expected Result:** âœ… All pages accessible, bottom nav always visible

**Potential Issues:**
- âš ï¸ Bottom nav missing on some pages
- âš ï¸ Active tab indicator wrong
- âš ï¸ Navigation doesn't work (Link component issue)
- âš ï¸ State reset when returning to dashboard

---

### Scenario 8: User Uploads a Clip
**Path:** Upload â†’ Select Video â†’ Fill Form â†’ Submit

#### Test Steps:
- [ ] 8.1 Navigate to `/upload`
- [ ] 8.2 Click "Select Video" or drag-drop
- [ ] 8.3 Choose video file
- [ ] 8.4 Verify validation:
  - [ ] File type: .mp4, .mov, .webm only
  - [ ] Duration: Must be 8 seconds (Â±0.5s tolerance)
  - [ ] Size: Max 50MB
  - [ ] Aspect ratio: 9:16 (vertical)
- [ ] 8.5 If invalid â†’ Show error toast
- [ ] 8.6 If valid â†’ Show preview thumbnail
- [ ] 8.7 Fill form fields:
  - [ ] Title (required, max 100 chars)
  - [ ] Description (optional, max 500 chars)
  - [ ] Genre selection (dropdown)
  - [ ] Slot position (auto-assigned or selectable)
- [ ] 8.8 Click "Upload" button
- [ ] 8.9 Verify POST `/api/upload` request:
  - [ ] Video uploaded to Supabase Storage (`videos` bucket)
  - [ ] Metadata saved to `tournament_clips` table
  - [ ] Response: `{ success: true, clipId }`
- [ ] 8.10 Show success message
- [ ] 8.11 Redirect to `/profile` or `/dashboard`

**Expected Result:** âœ… Upload succeeds, clip appears in voting pool

**Potential Issues:**
- âš ï¸ Large file upload times out
- âš ï¸ Duration validation incorrect (off by >0.5s)
- âš ï¸ File not uploaded to storage
- âš ï¸ Database entry created but video missing
- âš ï¸ No error feedback on failure

---

### Scenario 9: User Views Profile
**Path:** Profile â†’ See Stats â†’ View Uploaded Clips â†’ Check History

#### Test Steps:
- [ ] 9.1 Navigate to `/profile`
- [ ] 9.2 Verify GET `/api/profile/stats` request
- [ ] 9.3 Display should show:
  - [ ] User level (based on XP)
  - [ ] Total votes cast
  - [ ] Total clips uploaded
  - [ ] Badges earned (icons)
  - [ ] Current streak (days)
  - [ ] Daily progress bar
- [ ] 9.4 Scroll to "My Clips" section
- [ ] 9.5 Verify GET `/api/profile/clips` request
- [ ] 9.6 Display shows:
  - [ ] Thumbnail grid of uploaded clips
  - [ ] Each clip shows: votes, status (voting/locked/pending)
  - [ ] Tap clip â†’ navigate to `/clip/[id]`
- [ ] 9.7 Scroll to "Voting History"
- [ ] 9.8 Verify GET `/api/profile/history?page=1&limit=10`
- [ ] 9.9 Display shows:
  - [ ] List of recently voted clips
  - [ ] Date/time of vote
  - [ ] Slot number
  - [ ] Pagination controls
- [ ] 9.10 Test pagination (next/previous page)

**Expected Result:** âœ… All profile data loads correctly

**Potential Issues:**
- âš ï¸ Stats API returns 0s (no data found)
- âš ï¸ Clips don't load (wrong voter_key)
- âš ï¸ History pagination broken
- âš ï¸ Slow API responses (no caching)

---

### Scenario 10: User Votes for Genre (Season 2)
**Path:** Story Page â†’ Genre Voting Section â†’ Select Genre

#### Test Steps:
- [ ] 10.1 Navigate to `/story`
- [ ] 10.2 Scroll to "Vote Next Season Genre" section
- [ ] 10.3 Verify 7 genre tiles displayed:
  - [ ] ðŸ”ª Thriller
  - [ ] ðŸ˜‚ Comedy
  - [ ] ðŸ’¥ Action
  - [ ] ðŸš€ Sci-Fi
  - [ ] ðŸ’• Romance
  - [ ] ðŸŽ¨ Animation
  - [ ] ðŸ‘» Horror
- [ ] 10.4 Tap a genre tile (e.g., "Thriller")
- [ ] 10.5 Verify POST `/api/genre-vote` request:
  - [ ] Body: `{ genre: "Thriller" }`
  - [ ] Response: `{ success: true, results: {...} }`
- [ ] 10.6 Check UI updates:
  - [ ] Selected tile gets checkmark icon
  - [ ] Selected tile has glow/scale animation
  - [ ] Percentage bar updates for all genres
  - [ ] Toast: "âœ… Genre vote recorded!"
- [ ] 10.7 Tap different genre (e.g., "Sci-Fi")
- [ ] 10.8 Verify:
  - [ ] Previous vote UPDATES (not duplicates)
  - [ ] New genre gets checkmark
  - [ ] Old genre loses checkmark
- [ ] 10.9 Refresh page
- [ ] 10.10 Verify vote persists (selected genre still checked)

**Expected Result:** âœ… Genre voting works, one vote per user

**Potential Issues:**
- âš ï¸ Multiple votes allowed (unique constraint not working)
- âš ï¸ Percentages don't add up to 100%
- âš ï¸ Vote doesn't persist (not saved to DB)
- âš ï¸ Can't change vote after initial selection

---

## ðŸ”§ BACKEND/API SCENARIOS

### Scenario 11: No Active Season Exists
**State:** Database has 0 or multiple seasons, but NONE with `status = 'active'`

#### Test Steps:
- [ ] 11.1 In Supabase, set all seasons to `status = 'draft'` or `'archived'`
- [ ] 11.2 GET `/api/vote?trackId=track-main`
- [ ] 11.3 Expected response:
```json
{
  "clips": [],
  "totalVotesToday": 0,
  "userRank": 0,
  "remainingVotes": { "standard": 200, "super": 0, "mega": 0 },
  "streak": 1
}
```
- [ ] 11.4 Frontend should show:
  - [ ] Empty state message: "No active season. Check back soon!"
  - [ ] Disabled vote button
  - [ ] Placeholder graphic

**Expected Result:** âœ… Graceful empty state, no crashes

**Potential Issues:**
- âš ï¸ API throws 500 error instead of empty response
- âš ï¸ Frontend crashes trying to access `clips[0]`
- âš ï¸ Infinite loading spinner

---

### Scenario 12: Active Season But No Voting Slot
**State:** Season exists with `status = 'active'`, but NO slot has `status = 'voting'`

#### Test Steps:
- [ ] 12.1 In Supabase, set all `story_slots` to `status = 'upcoming'` or `'locked'`
- [ ] 12.2 GET `/api/vote?trackId=track-main`
- [ ] 12.3 Expected response: Same empty state as Scenario 11
- [ ] 12.4 Frontend shows: "Voting not started for this season yet"

**Expected Result:** âœ… Empty state handled

**Potential Issues:**
- âš ï¸ API tries to query clips with `slot_position = undefined` â†’ crash
- âš ï¸ No clear message to user

---

### Scenario 13: Active Slot But No Clips
**State:** Slot with `status = 'voting'` exists, but `tournament_clips` table has 0 rows for that slot

#### Test Steps:
- [ ] 13.1 In Supabase, delete all rows from `tournament_clips` where `slot_position = current_voting_slot`
- [ ] 13.2 GET `/api/vote?trackId=track-main`
- [ ] 13.3 Expected response: Empty clips array
- [ ] 13.4 Frontend shows: "No clips available for this slot yet"

**Expected Result:** âœ… Handled gracefully

**Potential Issues:**
- âš ï¸ Voting Arena shows blank screen
- âš ï¸ Swipe navigation breaks

---

### Scenario 14: User Votes When Already at Limit
**State:** User has already cast 200 votes today

#### Test Steps:
- [ ] 14.1 Manually insert 200 rows in `votes` table with today's date and same `voter_key`
- [ ] 14.2 GET `/api/vote?trackId=track-main`
- [ ] 14.3 Check response: `remainingVotes.standard = 0`
- [ ] 14.4 POST `/api/vote` with `{ clipId: "test-id" }`
- [ ] 14.5 Expected response:
```json
{
  "success": false,
  "error": "Daily vote limit reached"
}
```
- [ ] 14.6 Frontend shows disabled vote button

**Expected Result:** âœ… Limit enforced server-side

**Potential Issues:**
- âš ï¸ Limit check doesn't run (vote still counted)
- âš ï¸ Off-by-one error (allows 201 votes)

---

### Scenario 15: Multiple Devices, Same User
**State:** User votes on Phone A, then switches to Phone B

#### Test Steps:
- [ ] 15.1 On Device A (Chrome), cast 50 votes
- [ ] 15.2 Check `voter_key` hash (based on IP + User-Agent)
- [ ] 15.3 On Device B (Safari, same WiFi), cast 50 votes
- [ ] 15.4 Check `voter_key` â†’ Should be DIFFERENT (different User-Agent)
- [ ] 15.5 Verify: Both devices have separate 200-vote limits

**Expected Result:** âœ… Each device tracked separately

**Potential Issues:**
- âš ï¸ Same `voter_key` for different devices (weak hashing)
- âš ï¸ IP changes (mobile data) â†’ treated as new user

---

### Scenario 16: Concurrent Voting (Race Condition)
**State:** User taps vote button rapidly multiple times

#### Test Steps:
- [ ] 16.1 Disable `isVoting` flag temporarily
- [ ] 16.2 Tap âˆž button 10 times rapidly (within 1 second)
- [ ] 16.3 Check:
  - [ ] How many POST `/api/vote` requests sent? (Should be 10)
  - [ ] How many votes recorded in DB? (Should be 10)
  - [ ] Does `vote_count` increment correctly?
- [ ] 16.4 Re-enable `isVoting` flag
- [ ] 16.5 Repeat test
- [ ] 16.6 Verify: Only 1 vote per tap (flag prevents spam)

**Expected Result:** âœ… With `isVoting` flag, only 1 vote processed

**Potential Issues:**
- âš ï¸ Without flag, duplicate votes created
- âš ï¸ Database doesn't handle concurrent updates (lost updates)

---

### Scenario 17: Network Failure During Vote
**State:** User votes, but request fails (timeout, 500 error, etc.)

#### Test Steps:
- [ ] 17.1 Open browser DevTools â†’ Network tab
- [ ] 17.2 Enable "Offline" mode
- [ ] 17.3 Tap vote button
- [ ] 17.4 Verify:
  - [ ] POST `/api/vote` fails with `net::ERR_INTERNET_DISCONNECTED`
  - [ ] Optimistic update rolls back (vote_count decrements)
  - [ ] Error toast shows: "Failed to cast vote. Check connection."
  - [ ] `localVotesToday` doesn't increment
- [ ] 17.5 Disable offline mode
- [ ] 17.6 Tap vote again â†’ Should succeed

**Expected Result:** âœ… Error handled, state reverted

**Potential Issues:**
- âš ï¸ Optimistic update doesn't roll back (shows wrong count)
- âš ï¸ No error message to user
- âš ï¸ Vote button stays disabled

---

### Scenario 18: Real-Time Updates via Pusher
**State:** User A and User B voting on same clip simultaneously

#### Test Steps:
- [ ] 18.1 Verify `NEXT_PUBLIC_PUSHER_KEY` and `NEXT_PUBLIC_PUSHER_CLUSTER` set
- [ ] 18.2 Open app on 2 devices/browsers (A and B)
- [ ] 18.3 Both navigate to same clip (e.g., index 5)
- [ ] 18.4 User A votes â†’ POST `/api/vote` â†’ Pusher event sent
- [ ] 18.5 User B should see:
  - [ ] Vote count increment in real-time (no refresh needed)
  - [ ] Progress bar update
- [ ] 18.6 User B votes
- [ ] 18.7 User A sees User B's vote update

**Expected Result:** âœ… Real-time updates work

**Potential Issues:**
- âš ï¸ Pusher not configured â†’ no live updates
- âš ï¸ Channel subscription fails
- âš ï¸ Only manual refresh shows new votes

---

## ðŸš¨ EDGE CASES & ERROR HANDLING

### Scenario 19: User Clears Browser Data Mid-Session
**State:** User votes 50 times, then clears localStorage/cookies

#### Test Steps:
- [ ] 19.1 Cast 50 votes (verify `localVotesToday = 50`)
- [ ] 19.2 Open DevTools â†’ Application â†’ Storage
- [ ] 19.3 Clear all localStorage, cookies, cache
- [ ] 19.4 Refresh page
- [ ] 19.5 Verify:
  - [ ] `localVotesToday` resets to 0
  - [ ] But backend still has 50 votes (voter_key unchanged)
  - [ ] GET `/api/vote` returns `totalVotesToday = 50`
  - [ ] Progress sphere shows 50/200 correctly

**Expected Result:** âœ… Backend source of truth preserved

**Potential Issues:**
- âš ï¸ Local state and backend out of sync
- âš ï¸ Progress sphere shows wrong value

---

### Scenario 20: Malformed Request to /api/vote
**State:** Attacker sends invalid data to API

#### Test Steps:
- [ ] 20.1 POST `/api/vote` with no body
- [ ] 20.2 Expected: `{ success: false, error: "Invalid request" }` + 400 status
- [ ] 20.3 POST with wrong type: `{ clipId: 12345 }` (number instead of string)
- [ ] 20.4 Expected: 400 error
- [ ] 20.5 POST with SQL injection attempt: `{ clipId: "'; DROP TABLE votes;--" }`
- [ ] 20.6 Expected: Supabase parameterized queries prevent injection

**Expected Result:** âœ… All invalid requests rejected

**Potential Issues:**
- âš ï¸ No input validation â†’ crash
- âš ï¸ SQL injection possible

---

### Scenario 21: Supabase Connection Failure
**State:** Database unreachable (network issue, rate limit, etc.)

#### Test Steps:
- [ ] 21.1 Temporarily change `NEXT_PUBLIC_SUPABASE_URL` to invalid URL
- [ ] 21.2 Try to load `/dashboard`
- [ ] 21.3 GET `/api/vote` should return 500 error
- [ ] 21.4 Frontend shows:
  - [ ] Error boundary catches crash
  - [ ] Message: "Unable to connect to server. Please try again."
  - [ ] Retry button

**Expected Result:** âœ… Graceful degradation

**Potential Issues:**
- âš ï¸ App crashes with unhandled exception
- âš ï¸ Infinite loading state
- âš ï¸ No retry mechanism

---

### Scenario 22: Video Fails to Load
**State:** `video_url` in clip is broken/404

#### Test Steps:
- [ ] 22.1 Update a clip in DB with invalid `video_url`
- [ ] 22.2 Load that clip in Voting Arena
- [ ] 22.3 Video `<video>` element fires `onError` event
- [ ] 22.4 Show fallback:
  - [ ] Placeholder image
  - [ ] Message: "Video unavailable"
  - [ ] Skip button to next clip

**Expected Result:** âœ… Fallback UI shown

**Potential Issues:**
- âš ï¸ Black screen, no feedback
- âš ï¸ Video keeps loading forever
- âš ï¸ Can't skip to next clip

---

### Scenario 23: Timezone Differences (Daily Reset)
**State:** User in different timezone voting near midnight UTC

#### Test Steps:
- [ ] 23.1 User in EST (UTC-5) votes at 7:30 PM EST (12:30 AM UTC next day)
- [ ] 23.2 Backend counts votes in UTC day
- [ ] 23.3 Verify:
  - [ ] If function `getStartOfTodayUTC()` used â†’ counts as NEXT day
  - [ ] User's local perception: "I voted in the evening"
  - [ ] Server sees: "New day started"
- [ ] 23.4 At 8:00 PM EST (1:00 AM UTC), backend resets daily count
- [ ] 23.5 User can vote 200 more times

**Expected Result:** âœ… UTC-based day boundary consistent

**Potential Issues:**
- âš ï¸ Confusion for users (day resets at unexpected times)
- âš ï¸ Local time used instead of UTC â†’ inconsistent

---

### Scenario 24: Browser Doesn't Support Required APIs
**State:** Old browser without Vibration API, Local Storage, etc.

#### Test Steps:
- [ ] 24.1 Open app in IE11 or very old mobile browser
- [ ] 24.2 Check for `navigator.vibrate` â†’ undefined
- [ ] 24.3 Verify: Vote still works (vibration skipped)
- [ ] 24.4 Check `localStorage` â†’ throws error
- [ ] 24.5 Verify: App uses fallback (cookies or in-memory state)

**Expected Result:** âœ… Core functionality works without optional APIs

**Potential Issues:**
- âš ï¸ App crashes if `localStorage` not available
- âš ï¸ No fallback for missing APIs

---

### Scenario 25: Admin Locks a Slot Mid-Voting
**State:** Admin changes slot `status` from `'voting'` to `'locked'` while users are voting

#### Test Steps:
- [ ] 25.1 Users actively voting on Slot 5
- [ ] 25.2 Admin runs SQL: `UPDATE story_slots SET status = 'locked' WHERE slot_position = 5`
- [ ] 25.3 Admin sets Slot 6 to `status = 'voting'`
- [ ] 25.4 Users continue to load clips:
  - [ ] GET `/api/vote` now returns Slot 6 clips
  - [ ] Frontend switches to new slot automatically (on next refetch)
- [ ] 25.5 User tries to vote on old Slot 5 clip
- [ ] 25.6 POST `/api/vote` with Slot 5 `clipId`
- [ ] 25.7 Verify:
  - [ ] Vote still recorded (not slot-validated)
  - [ ] OR: API checks slot status and rejects

**Expected Result:** âœ… Transition handled smoothly

**Potential Issues:**
- âš ï¸ Votes lost during transition
- âš ï¸ Users see empty state briefly
- âš ï¸ No notification about slot change

---

## ðŸ“Š DATA INTEGRITY SCENARIOS

### Scenario 26: Vote Count Accuracy
**State:** Verify DB `vote_count` matches actual vote records

#### Test Steps:
- [ ] 26.1 In Supabase, insert test clip with `vote_count = 0`
- [ ] 26.2 Cast 10 votes on that clip via app
- [ ] 26.3 Run SQL:
```sql
SELECT 
  (SELECT vote_count FROM tournament_clips WHERE id = 'test-clip-id') as recorded_count,
  (SELECT COUNT(*) FROM votes WHERE clip_id = 'test-clip-id') as actual_count;
```
- [ ] 26.4 Verify: `recorded_count = actual_count = 10`

**Expected Result:** âœ… Counts match

**Potential Issues:**
- âš ï¸ Increment logic wrong (off by 1)
- âš ï¸ Concurrent updates cause lost increments
- âš ï¸ Votes table has duplicates

---

### Scenario 27: Duplicate Votes Prevention
**State:** Verify user can't vote twice for same clip in same day

#### Test Steps:
- [ ] 27.1 User votes for clip A
- [ ] 27.2 Record `voter_key` and `clip_id`
- [ ] 27.3 User navigates away, comes back to clip A
- [ ] 27.4 User votes again
- [ ] 27.5 Check DB:
```sql
SELECT COUNT(*) FROM votes 
WHERE voter_key = 'user-hash' 
AND clip_id = 'clip-A' 
AND DATE(created_at) = CURRENT_DATE;
```
- [ ] 27.6 If no constraint â†’ 2 votes exist (BAD)
- [ ] 27.7 If unique constraint â†’ 2nd vote rejected or first updated

**Expected Result:** âš ï¸ CURRENTLY ALLOWS DUPLICATES (no unique constraint)

**Recommendation:** Add constraint:
```sql
ALTER TABLE votes ADD CONSTRAINT unique_daily_vote 
UNIQUE (voter_key, clip_id, DATE(created_at));
```

---

### Scenario 28: Orphaned Clips
**State:** Clips in `tournament_clips` referencing deleted seasons/slots

#### Test Steps:
- [ ] 28.1 Delete a season from `seasons` table
- [ ] 28.2 Check if any `tournament_clips` still reference that season (via slot_position)
- [ ] 28.3 Query:
```sql
SELECT * FROM tournament_clips 
WHERE slot_position NOT IN (SELECT slot_position FROM story_slots);
```
- [ ] 28.4 If rows exist â†’ orphaned clips

**Expected Result:** âš ï¸ POSSIBLE IF NO FK CONSTRAINT

**Recommendation:** Add ON DELETE CASCADE or cleanup script

---

### Scenario 29: Negative Vote Counts
**State:** Verify `vote_count` can never go negative

#### Test Steps:
- [ ] 29.1 Manually set clip `vote_count = 0`
- [ ] 29.2 Try to decrement (if admin has "undo vote" feature)
- [ ] 29.3 Check: `vote_count` stays at 0 (doesn't go to -1)

**Expected Result:** âœ… Floor at 0

**Potential Issues:**
- âš ï¸ If no check constraint, can go negative

---

### Scenario 30: Daily Reset Logic
**State:** Verify votes reset at correct UTC midnight

#### Test Steps:
- [ ] 30.1 Cast votes at 11:50 PM UTC (10 minutes before midnight)
- [ ] 30.2 Record `totalVotesToday`
- [ ] 30.3 Wait until 12:05 AM UTC (5 minutes after midnight)
- [ ] 30.4 GET `/api/vote`
- [ ] 30.5 Verify: `totalVotesToday = 0` (new day started)
- [ ] 30.6 Check `remainingVotes = 200` (limit reset)

**Expected Result:** âœ… Clean daily reset

**Potential Issues:**
- âš ï¸ Uses local time instead of UTC
- âš ï¸ Off-by-one day error

---

## ðŸŽ¯ PERFORMANCE SCENARIOS

### Scenario 31: Large Clip Pool (1000+ clips)
**State:** Slot has 1000 tournament clips

#### Test Steps:
- [ ] 31.1 Insert 1000 clips for current voting slot
- [ ] 31.2 GET `/api/vote?trackId=track-main`
- [ ] 31.3 Measure response time
- [ ] 31.4 Verify:
  - [ ] Only `CLIP_POOL_SIZE (30)` clips returned
  - [ ] Response < 2 seconds
- [ ] 31.5 Check query performance in Supabase logs

**Expected Result:** âœ… Fast due to LIMIT clause

**Potential Issues:**
- âš ï¸ No LIMIT â†’ fetches all 1000 clips â†’ slow
- âš ï¸ Missing indexes on `slot_position` â†’ full table scan

---

### Scenario 32: High Vote Volume (100 votes/second)
**State:** Simulate traffic spike

#### Test Steps:
- [ ] 32.1 Use load testing tool (k6, Artillery)
- [ ] 32.2 Send 100 POST `/api/vote` requests per second for 60 seconds
- [ ] 32.3 Monitor:
  - [ ] Response times (should stay < 500ms)
  - [ ] Error rate (should be < 1%)
  - [ ] Database CPU/memory usage
- [ ] 32.4 Check for:
  - [ ] Deadlocks
  - [ ] Connection pool exhaustion
  - [ ] Rate limiting (if enabled)

**Expected Result:** âœ… System handles load (with scaling)

**Potential Issues:**
- âš ï¸ Database overwhelmed
- âš ï¸ API crashes under load
- âš ï¸ Pusher rate limits exceeded

---

### Scenario 33: Caching Effectiveness
**State:** Verify API responses cached correctly

#### Test Steps:
- [ ] 33.1 If caching implemented (see FIXES-DELIVERY-SUMMARY.md)
- [ ] 33.2 GET `/api/vote` (first call)
- [ ] 33.3 Measure: ~800ms (DB query)
- [ ] 33.4 GET `/api/vote` (second call within 10s)
- [ ] 33.5 Measure: ~150ms (cache hit)
- [ ] 33.6 Wait 11 seconds (cache TTL expires)
- [ ] 33.7 GET `/api/vote` again
- [ ] 33.8 Measure: ~800ms (cache miss, refetch)

**Expected Result:** âœ… 5-6x speedup with cache

**Potential Issues:**
- âš ï¸ Cache not implemented yet
- âš ï¸ Cache invalidation doesn't work (stale data)

---

## ðŸ”’ SECURITY SCENARIOS

### Scenario 34: Admin Routes Without Auth
**State:** Verify admin endpoints protected

#### Test Steps:
- [ ] 34.1 Without auth token:
  - [ ] GET `/api/admin/stats` â†’ 401 Unauthorized
  - [ ] GET `/api/admin/seasons` â†’ 401 Unauthorized
  - [ ] POST `/api/admin/slots` â†’ 401 Unauthorized
- [ ] 34.2 With valid token:
  - [ ] Add header: `x-api-key: valid-token`
  - [ ] GET `/api/admin/stats` â†’ 200 OK

**Expected Result:** âœ… If middleware enabled, protected

**Potential Issues:**
- âš ï¸ `ADMIN_TOKENS_ENABLED = false` â†’ routes open
- âš ï¸ Middleware not applied â†’ bypassed

---

### Scenario 35: Rate Limiting
**State:** Prevent API abuse

#### Test Steps:
- [ ] 35.1 Send 61 requests to `/api/vote` within 1 minute
- [ ] 35.2 Expected:
  - [ ] First 60: 200 OK
  - [ ] 61st: 429 Too Many Requests
  - [ ] Header: `Retry-After: 60` (seconds)
- [ ] 35.3 Wait 60 seconds
- [ ] 35.4 Try again â†’ Should work

**Expected Result:** âœ… Rate limit enforced

**Potential Issues:**
- âš ï¸ Not implemented â†’ DDoS vulnerable
- âš ï¸ Limit too strict (affects normal users)

---

### Scenario 36: CSRF Protection
**State:** Verify cross-site requests blocked

#### Test Steps:
- [ ] 36.1 Create malicious site: `evil.com`
- [ ] 36.2 Add form that POSTs to your API:
```html
<form action="https://aimoviez.com/api/vote" method="POST">
  <input name="clipId" value="malicious-id">
</form>
```
- [ ] 36.3 Submit form
- [ ] 36.4 Verify: CORS policy blocks request (if same-site cookies used)

**Expected Result:** âœ… CORS prevents cross-origin POST

**Potential Issues:**
- âš ï¸ CORS misconfigured (allows all origins)

---

### Scenario 37: Sensitive Data Exposure
**State:** Check for leaked secrets in client-side code

#### Test Steps:
- [ ] 37.1 View page source
- [ ] 37.2 Search for:
  - [ ] `SUPABASE_SERVICE_ROLE_KEY` (should NOT be in client)
  - [ ] `ADMIN_SECRET_KEY` (should NOT be in client)
  - [ ] `PUSHER_SECRET` (should NOT be in client)
- [ ] 37.3 Verify only public keys present:
  - [ ] `NEXT_PUBLIC_SUPABASE_URL` âœ…
  - [ ] `NEXT_PUBLIC_PUSHER_KEY` âœ…

**Expected Result:** âœ… No secrets in client bundle

**Potential Issues:**
- âš ï¸ Accidentally used `process.env.SECRET` in client component

---

## ðŸ“± MOBILE-SPECIFIC SCENARIOS

### Scenario 38: Touch Gestures on Mobile
**State:** Test swipe, tap, long-press on real device

#### Test Steps:
- [ ] 38.1 Open app on actual iPhone/Android
- [ ] 38.2 Test swipe up â†’ Next clip
- [ ] 38.3 Test swipe down â†’ Previous clip
- [ ] 38.4 Test tap âˆž button â†’ Vote cast
- [ ] 38.5 Test long-press (no action expected)
- [ ] 38.6 Test pinch-zoom (should be disabled)

**Expected Result:** âœ… All gestures work smoothly

**Potential Issues:**
- âš ï¸ Swipe conflicts with browser pull-to-refresh
- âš ï¸ Accidental double-tap zoom

---

### Scenario 39: Landscape Orientation
**State:** User rotates phone to landscape

#### Test Steps:
- [ ] 39.1 Start in portrait (vertical video)
- [ ] 39.2 Rotate to landscape
- [ ] 39.3 Verify:
  - [ ] Video resizes (black bars on sides)
  - [ ] UI elements reposition
  - [ ] Vote button still accessible
- [ ] 39.4 Rotate back to portrait

**Expected Result:** âœ… Responsive to orientation

**Potential Issues:**
- âš ï¸ UI breaks in landscape
- âš ï¸ Video crops incorrectly

---

### Scenario 40: Slow Mobile Connection (3G)
**State:** Throttle network to 3G speed

#### Test Steps:
- [ ] 40.1 DevTools â†’ Network â†’ Throttle to "Slow 3G"
- [ ] 40.2 Load `/dashboard`
- [ ] 40.3 Measure load time (should be < 10s)
- [ ] 40.4 Check for:
  - [ ] Loading spinners shown
  - [ ] Progressive enhancement (text loads first)
  - [ ] Videos lazy load

**Expected Result:** âœ… Usable on slow connection

**Potential Issues:**
- âš ï¸ Timeout errors
- âš ï¸ No loading indicators

---

## ðŸ§ª FINAL CHECKLIST

### Critical Path (Must Work):
- [ ] âœ… First-time user onboarding (Scenario 1)
- [ ] âœ… Returning user auto-redirect (Scenario 2)
- [ ] âœ… Voting within limit (Scenario 3)
- [ ] âœ… Daily limit enforced (Scenario 4)
- [ ] âœ… Swipe navigation (Scenario 5)
- [ ] âœ… Bottom nav works (Scenario 7)

### High Priority:
- [ ] âš ï¸ Network failure handling (Scenario 17)
- [ ] âš ï¸ Empty states (Scenarios 11-13)
- [ ] âš ï¸ Vote count accuracy (Scenario 26)
- [ ] âš ï¸ Admin auth (Scenario 34)

### Medium Priority:
- [ ] â³ Comments UI (Scenario 6)
- [ ] â³ Real-time updates (Scenario 18)
- [ ] â³ Upload flow (Scenario 8)
- [ ] â³ Profile stats (Scenario 9)

### Nice to Have:
- [ ] ðŸŒŸ Genre voting (Scenario 10)
- [ ] ðŸŒŸ Performance optimization (Scenarios 31-33)
- [ ] ðŸŒŸ Mobile gestures (Scenarios 38-40)

---

## ðŸ› KNOWN ISSUES FROM ANALYSIS

### ðŸ”´ CRITICAL ISSUES:
1. **No unique constraint on daily votes** â†’ Users can vote multiple times for same clip
2. **localVotesToday can desync from backend** â†’ Progress bar inaccurate
3. **No FK constraint on votes.clip_id** â†’ Orphaned votes possible

### ðŸŸ¡ MEDIUM ISSUES:
4. **Swipe works when comments open** â†’ Should be disabled
5. **No error boundary** â†’ Crashes bubble up to white screen
6. **Video loading failure not handled** â†’ Black screen
7. **No retry mechanism** for failed API calls

### ðŸŸ¢ MINOR ISSUES:
8. **Genre voting percentages** â†’ May not add to 100% due to rounding
9. **Timezone confusion** â†’ Daily reset at UTC midnight (unexpected for users)
10. **No rate limiting on client** â†’ Could spam backend

---

## ðŸ“‹ TESTING TOOLS NEEDED

1. **Manual Testing:**
   - Chrome DevTools (Network, Application tabs)
   - Real iPhone + Android device
   - Supabase SQL Editor

2. **Automated Testing (Future):**
   - Jest + React Testing Library (unit tests)
   - Playwright (E2E tests)
   - k6 or Artillery (load testing)

3. **Monitoring (Production):**
   - Sentry (error tracking)
   - Vercel Analytics (performance)
   - Supabase Logs (DB queries)

---

## âœ… SIGN-OFF

**Tested By:** _____________  
**Date:** _____________  
**Scenarios Passed:** _____ / 40  
**Critical Issues Found:** _____  
**Ready for Production:** YES / NO

---

**Next Steps After Testing:**
1. Fix all ðŸ”´ CRITICAL issues before launch
2. Address ðŸŸ¡ MEDIUM issues in first update
3. Document ðŸŸ¢ MINOR issues for backlog
4. Create automated test suite
5. Set up production monitoring

