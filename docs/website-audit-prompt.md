# HashTracks Pre-Launch Website Audit — Browser Prompt

> **How to use:** Copy this entire prompt and give it to Claude in Chrome (computer use). Claude will systematically walk through every user flow on hashtracks.com, documenting bugs, inconsistencies, and polish issues. Feed the output to Claude CLI for prioritization and fixes.

---

## Prompt

You are performing a comprehensive pre-launch QA audit of **HashTracks** (hashtracks.com), a community platform for hash house harriers. Your job is to systematically walk through every user-facing flow on both **desktop (1440px)** and **mobile (390px iPhone)** viewports, documenting every bug, visual inconsistency, UX rough edge, and polish issue you find.

### Ground Rules

- Take a screenshot at every step. Reference screenshots by number in your findings.
- Test at **two viewport sizes**: desktop (1440×900) and mobile (390×844). Note which viewport each finding applies to.
- For each finding, note: **Area** (page/component), **Severity** (P0 blocker / P1 major / P2 minor / P3 polish), **Viewport** (desktop/mobile/both), and a clear **Description** of the issue.
- At the end, produce a single **Findings Table** in markdown format (see Output Format below).
- Be thorough but practical — flag real problems, not subjective style preferences.

---

## PART 1: Unauthenticated Experience

### 1.1 Homepage (`/`)
1. Load the homepage. Check:
   - Hero section renders fully — animated counters tick up, region ticker scrolls, no layout shift
   - CTA buttons ("Explore the Hareline", "Find Your Kennel", sign-up CTAs) are visible and clickable
   - Feature showcase cards are evenly spaced, images load, text is readable
   - "How It Works" section is clear and complete
   - Live stats section shows real numbers (not zeros or NaN)
   - Footer renders: logo, links (Hareline, Kennels, Logbook, For Misman, About, Feedback), copyright
2. **Mobile**: Check that hero doesn't overflow, CTAs are tap-friendly (min 44px), ticker doesn't clip, bottom nav appears

### 1.2 Hareline — List View (`/hareline`)
1. Load the hareline. Confirm default view is "list" with "upcoming" time filter.
2. **Event cards**: Check each card shows:
   - Date with sticky date header grouping
   - Kennel short name + region-colored left border
   - Start time (with timezone abbreviation)
   - Location, hares, event title (if present)
   - Weather emoji + temp (for events within 10 days)
   - Run number (if present)
3. **Density toggle**: Switch between "medium" (card) and "compact" (table) modes. Confirm both render cleanly.
4. **Pagination**: Scroll to bottom — confirm "show more" loads additional events without jumping scroll position.
5. **Desktop master-detail**: Click an event — confirm detail panel opens on the right (380px). Check it shows: full date, kennel link, region badge, run #, time, hares, location (Google Maps link), map image, description, calendar export, source links. Press Escape to dismiss.
6. **Mobile**: Confirm clicking an event navigates to the full event detail page (no side panel). Check back navigation works.

### 1.3 Hareline — Filters
1. **Time filters**: Toggle through 2w → 4w → 8w → 12w → all upcoming → past. Confirm event list updates and past events show in reverse chronological order.
2. **Region filter**: Open the region popover. Confirm it lists all regions with search. Select one region — confirm events filter. Select multiple — confirm AND/OR behavior. Clear — confirm all events return.
3. **Day-of-week filter**: Toggle individual days (Mon–Sun). Confirm events filter by day. Toggle multiple days. Clear all.
4. **Country filter**: If visible (2+ countries in data), toggle between countries. Confirm filtering works.
5. **Near Me filter**: Click "Near Me". If geolocation prompts, grant it. Confirm distance options appear (5/10/15/25/50 km). Select one — confirm events filter by distance. Check that km→mi tooltip appears on hover/tap.
6. **Kennel filter**: Open kennel popover. Confirm it shows kennels filtered by any active region selection. Select kennels — confirm filtering.
7. **Clear filters**: With several filters active, click "Clear". Confirm all reset.
8. **URL persistence**: Apply filters → copy URL → open in new tab → confirm same filters are applied.
9. **Empty state**: Apply filters that yield zero results. Confirm a helpful empty state message appears with option to clear filters.
10. **Mobile**: Confirm filter bar scrolls horizontally. All popovers are usable on small screens (not clipped, dismissible). Active filter badges show counts.

### 1.4 Hareline — Calendar View
1. Switch to calendar view. Confirm:
   - Month grid renders with correct days
   - Event badges appear in cells with region colors and kennel short names
   - Overflow cells show "+N more" that opens a popover with full list
   - Prev/Next month navigation works, "Today" button returns to current month
2. **Weeks mode**: Apply a rolling time filter (2w/4w). Confirm calendar switches to weeks mode automatically. Check date range label is correct.
3. **Tooltips**: Hover over event badges — confirm tooltip shows full event details (fullName, region, run#, time with tz).
4. **Day selection**: Click a day — confirm detail panel (desktop) or navigation (mobile) shows that day's events.
5. **Keyboard**: Use arrow keys to navigate between days. Confirm focus ring is visible.
6. **Color legend**: Confirm region color legend is visible and matches badge colors.
7. **Mobile**: Check that calendar cells aren't too cramped, text is legible, badges don't overflow cells.

### 1.5 Hareline — Map View
1. Switch to map view. Confirm:
   - Map renders with event pins
   - Pins use region colors (filled = exact coords, hollow = approximate/centroid)
   - Legend overlay explains pin types and shows counts
   - Clicking a pin selects the event and shows detail panel (desktop) or navigates (mobile)
2. **Clustering**: Zoom out — confirm pins cluster at high density. Zoom in — confirm they spread.
3. **Auto-zoom**: Apply a filter — confirm map re-fits bounds to visible events.
4. **Reset view**: Click reset button — confirm map returns to default bounds.
5. **Precision banner**: On first visit, confirm a dismissible banner explains approximate vs exact locations.
6. **Default time filter**: Confirm map defaults to 4w (not "all upcoming").
7. **Mobile**: Check map is full-width, controls aren't overlapping, pins are tappable.

### 1.6 Event Detail Page (`/hareline/[eventId]`)
1. Navigate to a specific event detail page (click from hareline on mobile, or use direct URL).
2. Check:
   - Breadcrumb back to Hareline
   - Full date, kennel name (linked to kennel page), region badge, status badge
   - Run number, start time with timezone
   - Hares listed (linked to profiles if available)
   - Location with clickable Google Maps link
   - Map image (EventLocationMap) renders
   - Weather card (if within 10 days)
   - Description text preserved with whitespace
   - Source links dropdown
   - Calendar export button (iCal download)
   - "View Kennel" button links correctly
3. **Check-in button (unauthenticated)**: Confirm it shows a sign-in prompt rather than crashing.
4. **Mobile**: Confirm layout stacks vertically (details above, map below). No horizontal overflow.

### 1.7 Kennel Directory (`/kennels`)
1. Load the kennel directory. Confirm:
   - Grid of kennel cards renders (1 col mobile, 2 col tablet, 3 col desktop)
   - Cards grouped by region when sorted A–Z
   - Each card shows: shortName, fullName, region badge, schedule, description (2-line clamp), next run date
2. **Search**: Type a kennel name — confirm results filter in real-time. Try partial matches, aliases.
3. **Sort options**: Toggle A–Z → Recently Active → (Nearest if geolocation granted). Confirm sort order changes.
4. **Filters**: Test all kennel filters:
   - Region: multi-select, hierarchical grouping
   - Run Day: toggle buttons (Mon–Sun)
   - Frequency: dropdown (Weekly, Biweekly, Monthly, etc.)
   - Has Upcoming: boolean toggle
   - Country: toggle buttons
   - Near Me: geolocation + distance
   - Clear filters
5. **Map view**: Switch to map display. Confirm pins render for kennels with coordinates. Click a region cluster — confirm it filters/zooms.
6. **URL persistence**: Apply filters → copy URL → new tab → confirm filters preserved.
7. **Empty state**: Filter to no results — confirm helpful message.
8. **Mobile**: Confirm cards are full-width, search is prominent, filter bar scrolls.

### 1.8 Kennel Detail Page (`/kennels/[slug]`)
1. Navigate to a kennel with rich data (e.g., a NYC kennel). Check:
   - Hero: logo/initials, fullName, shortName, region badge, country, member count
   - Subscribe button visible (or sign-in prompt for unauthenticated)
   - Quick Info Card: schedule (day, time, frequency), hash cash, website link, founded year, dog/walker badges
   - Social links: all icons render, links open in new tab
   - Description: expandable "read more" if long
   - Stats cards: Total Runs (animated counter), Years Active, Next Run (relative date)
   - Event tabs: Upcoming (default 4, expandable) and Past (default 10, expandable) with count badges
   - Trail location map (if events have coordinates)
2. **Edge cases**: Visit a kennel with minimal data (no description, no social links, no events). Confirm graceful handling — no broken layouts, empty sections hidden or showing appropriate placeholders.
3. **Mobile**: Confirm hero stacks well, stats cards wrap, event list is scrollable, map is full-width.

### 1.9 Static Pages
1. **About page** (`/about`): Loads, content is readable, links work.
2. **For Misman page** (`/for-misman`): Marketing content renders, CTAs link correctly (sign up, request access).
3. **Sign-in** (`/sign-in`): Clerk form renders, Google OAuth button visible, styling matches site theme.
4. **Sign-up** (`/sign-up`): Same checks as sign-in. Tagline is present and readable.

---

## PART 2: Authenticated Experience

> Sign in with a test account (Google OAuth or email/password).

### 2.1 Header & Navigation (Post-Auth)
1. Confirm header shows: Hareline, Logbook, Kennels, Profile links + Clerk UserButton avatar.
2. Check Misman link appears only if user has misman role.
3. Check Admin link appears only if user has admin role.
4. **Mobile**: Confirm bottom nav shows Hareline, Kennels, Logbook, Profile, More. "More" opens sheet with additional links and preference toggles.

### 2.2 Hareline — Authenticated Features
1. **Scope toggle**: Confirm "My Kennels" / "All Kennels" toggle appears (only if user has subscriptions).
   - "My Kennels" filters to subscribed kennels only
   - "All Kennels" shows everything
2. **RSVP (future event)**: Click "I'm Going" on a future event. Confirm:
   - Button changes to "Going" with blue pulse indicator
   - Event appears in Logbook under Upcoming
   - Can remove RSVP (button returns to "I'm Going")
3. **Check-in (past event)**: Click "I Was There" on a past event. Confirm:
   - Participation level selector appears or defaults
   - Event appears in Logbook under Past Runs
   - Badge count updates on event card
4. **Attendance indicators**: Across hareline list, calendar, and map — confirm consistent display of RSVP/check-in status (blue pulse for Going, green for Checked In, etc.).

### 2.3 Logbook (`/logbook`)
1. Confirm two sections: "Upcoming" (RSVPs) and "Past Runs" (confirmed attendance).
2. **Event rows**: Check each shows:
   - Date, kennel name, region badge, run #, trail name, participation level badge
   - Color-coded left border (blue for upcoming, region-color for past)
   - Edit and remove action buttons
3. **Filters**: Test region, kennel, and participation level filters. Confirm filtering works.
4. **Edit attendance**: Click edit on an entry. Confirm dialog opens with:
   - Participation level selector (HARE, FLY, RUN, WALKER, VISITOR, SWEEP)
   - Notes field
   - Strava URL field
   - Save/Delete buttons
5. **Stats cards**: Confirm total runs, hares, unique kennels show correct numbers.
6. **Strava nudge banner**: If Strava not connected, confirm banner appears prompting connection.
7. **Pending confirmations**: If any misman-recorded attendance exists, confirm pending confirmation banner appears.
8. **Empty state**: For a new user with no attendance, confirm helpful empty state with CTA to explore hareline.
9. **Mobile**: Confirm rows display cleanly, secondary metadata wraps to second line, edit actions are accessible.

### 2.4 Logbook Stats (`/logbook/stats`)
1. Navigate to stats page. Confirm charts render:
   - Day of week chart
   - Runs by year chart
   - Any other stat visualizations
2. **Mobile**: Confirm charts are responsive, labels readable.

### 2.5 Profile (`/profile`)
1. Confirm sections: Identity, Strava, Kennel Connections, My Kennels.
2. **Identity form**: Edit hash name, nerd name, bio. Save — confirm changes persist on reload.
3. **Email**: Confirm read-only (managed by Clerk).
4. **Strava connection**: If not connected, confirm "Connect with Strava" button. If connected, confirm athlete name, last sync, "Sync Now" and "Disconnect" buttons.
5. **My Kennels**: Confirm subscribed kennels listed. Can unsubscribe.
6. **Kennel Connections**: Confirm any active/pending misman connections shown.
7. **Mobile**: Confirm form fields are full-width, sections stack well.

### 2.6 Kennel Subscription Flow
1. From kennel directory or kennel detail page, click Subscribe. Confirm:
   - Button changes to "Subscribed" / unsubscribe state
   - Kennel appears in Profile → My Kennels
   - Hareline "My Kennels" scope now includes this kennel
2. Unsubscribe and confirm reverse.

---

## PART 3: Misman (Kennel Management) Flows

> Requires misman role. If the test account doesn't have it, skip this section and note it.

### 3.1 Misman Dashboard (`/misman`)
1. Confirm kennel cards render with action buttons (Attendance, Roster, History).
2. **Multi-kennel**: If managing multiple kennels, confirm KennelSwitcher dropdown works.
3. **Request another kennel**: Confirm "Missing a kennel?" CTA opens kennel picker.
4. **Mobile**: Confirm cards stack, action buttons are tappable.

### 3.2 Attendance Recording (`/misman/[slug]/attendance`)
1. Select an event from the event picker.
2. **Stats bar**: Confirm attendee count, paid/hare/virgin/visitor counts display.
3. **Suggestion chips**: Confirm smart suggestions appear (capped at 10). Tap one — confirm hasher added to attendance list.
4. **Hasher search**: Search for a roster member. Add them. Confirm they appear in the list.
5. **Attendance row**: Check each row has: name, paid checkbox, hare checkbox, virgin checkbox, visitor toggle, referral source, edit/remove.
6. **Live polling**: Confirm attendance list refreshes periodically (4-second polling) to show check-ins from the website.
7. **User activity section**: If any users have RSVP'd, confirm their activity shows.
8. **Clear all**: Test "Clear All Attendance" with confirmation dialog.
9. **Mobile**: Confirm the form is usable on small screens — checkboxes have adequate touch targets, scrolling works.

### 3.3 Roster (`/misman/[slug]/roster`)
1. Confirm roster table renders with: name, email, phone, attendance count, linked user badge.
2. **Search**: Filter roster by name. Confirm results.
3. **Add hasher**: Add a new hasher. Confirm they appear in roster.
4. **Edit hasher**: Edit a hasher's details. Save and confirm.
5. **Duplicate scan**: Run duplicate detection. Confirm results show potential matches.
6. **Merge**: If duplicates found, test merge preview dialog — confirm side-by-side comparison.

### 3.4 History (`/misman/[slug]/history`)
1. Confirm historical attendance records display.
2. **Hasher detail**: Click a hasher — confirm detail view with attendance history and audit log.
3. **Filters**: Test event/date filters.

### 3.5 Import (`/misman/[slug]/import`)
1. Confirm CSV upload interface renders.
2. **Preview**: Upload a CSV — confirm preview table with hasher matching.

### 3.6 Kennel Navigation Tabs
1. Confirm tabs (Attendance, Roster, History, Import, Settings) switch correctly.
2. **Desktop**: Labels visible.
3. **Mobile**: Icons with indicator dots. Confirm active tab is visually distinct.

---

## PART 4: Cross-Cutting Consistency Checks

### 4.1 Filter Consistency
Compare filters across these three contexts and note any inconsistencies:

| Filter | Hareline | Kennel Directory | Logbook |
|--------|----------|-----------------|---------|
| Region | Multi-select popover | Multi-select popover | Multi-select? |
| Day of Week | Toggle buttons (Sun–Sat) | Toggle buttons (Mon–Sun) | N/A? |
| Near Me | Geolocation + km | Geolocation + km | N/A |
| Kennel | Multi-select popover | N/A (is the list) | Multi-select? |
| Search | Part of kennel filter? | Dedicated search bar | N/A? |
| Country | Toggle buttons | Toggle buttons | N/A? |

**Specifically check:**
- Do region filter popovers look and behave identically in hareline vs kennel directory?
- Is the day-of-week order consistent (Sun-first vs Mon-first)?
- Are filter clear buttons styled the same?
- Do active filter indicators (badges, counts, highlights) use the same patterns?
- Is the Near Me UX identical in both contexts?

### 4.2 Event Data Presentation Consistency
View the **same event** across these surfaces and check that information is presented consistently:

| Field | Hareline Card | Calendar Badge | Map Pin/Panel | Event Detail Page | Logbook Row | Kennel Page Event List |
|-------|--------------|----------------|---------------|-------------------|-------------|----------------------|
| Date format | | | | | | |
| Time format + tz | | | | | | |
| Kennel name (short vs full) | | | | | | |
| Region badge style | | | | | | |
| Run number format | | | | | | |
| Location display | | | | | | |
| Hares display | | | | | | |
| Status badge | | | | | | |

Note any differences in: formatting, presence/absence of fields, truncation behavior, or styling.

### 4.3 Region Badge Consistency
- Check that region badges use the same component, colors, and sizing across: hareline cards, event detail, kennel cards, kennel detail, logbook rows, calendar badges.
- Check that region-colored borders/accents are consistent.

### 4.4 Mobile Navigation & Layout
1. **Bottom nav**: Confirm it appears on all pages, stays fixed, doesn't overlap content, respects safe area.
2. **Header**: Confirm logo is visible, no nav links shown (they're in bottom nav), UserButton/SignIn accessible.
3. **Content padding**: Confirm `pb-24` gives enough clearance above bottom nav on all pages.
4. **Touch targets**: Spot-check that all buttons, links, checkboxes, and toggles are at least 44px tap targets.
5. **Horizontal overflow**: On every page, check for horizontal scroll (there should be none).
6. **Text truncation**: Check that long kennel names, event titles, and descriptions truncate gracefully (no overflow, ellipsis where appropriate).
7. **Modals/Dialogs**: Open any dialog on mobile — confirm it's full-width or properly sized, dismissible, not clipped.
8. **Popovers**: Open filter popovers on mobile — confirm they don't extend beyond viewport.

### 4.5 Theming & Visual Consistency
1. **Typography**: Check that headings, body text, and labels use consistent font sizes and weights across pages. No mix of serif/sans-serif.
2. **Spacing**: Check that card padding, section spacing, and margins are consistent across similar components.
3. **Button styles**: Compare primary, secondary, and ghost buttons across pages. Same border-radius, padding, font?
4. **Card styles**: Compare EventCard, KennelCard, logbook rows, stats cards — consistent border-radius, shadow, padding?
5. **Badge styles**: Compare region badges, status badges, count badges — consistent sizing and styling?
6. **Color usage**: Check that semantic colors are used consistently (primary for CTAs, destructive for deletes, muted for secondary info).
7. **Loading states**: Navigate between pages — check for loading indicators. Are they consistent (spinners vs skeletons vs nothing)?
8. **Transitions**: Page transitions, filter changes, panel open/close — smooth or jarring?

### 4.6 Time & Units
1. **Time preference toggle**: Switch between "Event Local" and "My Local" time (via header or More sheet). Confirm:
   - Hareline event times update
   - Event detail page times update
   - Calendar view times update
   - Timezone abbreviation changes (e.g., EST → PST)
2. **Temperature units**: Switch between °F and °C. Confirm weather displays update on hareline and event detail.
3. **Persistence**: Refresh the page — confirm preferences persist.

### 4.7 Empty States & Edge Cases
1. **New user with no data**: Check logbook, profile, kennel subscriptions — all show helpful empty states.
2. **Kennel with no events**: Visit a kennel that has no upcoming or past events. Check tab displays.
3. **Event with minimal data**: Find an event with only date + kennel (no time, location, hares, description). Confirm it renders without "undefined", "null", or broken layout.
4. **Very long content**: Check events or kennels with very long names, descriptions, or location strings. No overflow or layout breakage.
5. **Cancelled event**: Find a cancelled event. Confirm status badge is visible, styling is distinct (muted/strikethrough).

### 4.8 Performance & Loading
1. **Initial load**: Is the hareline fast to load? Any flash of unstyled content?
2. **Filter responsiveness**: Are filter changes instant or laggy?
3. **Map performance**: Does the map view load quickly? Smooth panning/zooming?
4. **Image loading**: Do map images (EventLocationMap) load or show broken image placeholders?
5. **Pagination**: Does "show more" on hareline or kennel events load smoothly?

---

## PART 5: Specific Bug Hunts

### 5.1 Navigation & Routing
- Click every link in the header (desktop) and bottom nav (mobile). Confirm correct pages load.
- Click every link in the footer. Confirm correct pages load.
- Use browser back/forward after navigating through several pages. Confirm correct behavior.
- Check that active link indicators (header, bottom nav, kennel tabs) highlight correctly.

### 5.2 Accessibility Quick Check
- Tab through the main hareline page — confirm focus order is logical, focus rings are visible.
- Check that all images have alt text or are decorative (aria-hidden).
- Check that filter popovers are keyboard-accessible (open, navigate, select, close with Escape).
- Check screen reader landmarks: header, main, nav, footer present.

### 5.3 Data Integrity Spot Check
- Pick 3 random events on the hareline. Click through to their detail pages. Confirm:
  - Date matches what was shown on the hareline
  - Kennel link goes to the correct kennel page
  - If source URL exists, it leads to a real page (not 404)
- Pick 3 kennel pages. Confirm:
  - Next run date matches what the hareline shows
  - Event count is plausible
  - Region is correct

---

## Output Format

At the end of your audit, produce findings in this exact format:

```markdown
# HashTracks Pre-Launch Audit Findings

**Date:** [date]
**Viewports tested:** Desktop 1440px, Mobile 390px
**Auth states tested:** Unauthenticated, Authenticated [, Misman]

## Summary
- P0 (Blocker): X findings
- P1 (Major): X findings
- P2 (Minor): X findings
- P3 (Polish): X findings

## Findings

| # | Area | Severity | Viewport | Description | Screenshot |
|---|------|----------|----------|-------------|------------|
| 1 | Hareline > List | P2 | Mobile | Day-of-week filter buttons overflow container on small screens | Screenshot 14 |
| 2 | Kennel Detail | P3 | Both | Stats card "Years Active" shows "0" for kennel founded this year | Screenshot 23 |
| ... | | | | | |

## Consistency Issues

### Filter Behavior Differences
[List any filter inconsistencies between hareline, kennel directory, and logbook]

### Data Presentation Differences
[List any differences in how the same event data appears across surfaces]

### Theming Inconsistencies
[List any visual inconsistencies: spacing, colors, typography, component styles]

## Positive Notes
[List things that work particularly well — good patterns to preserve]
```

---

**Important reminders:**
- Test BOTH desktop and mobile for every section
- Take screenshots liberally — they're your evidence
- Don't just look at happy paths — test edge cases, empty states, and error conditions
- Pay special attention to consistency BETWEEN pages (same data shown differently is a bug)
- The output will be consumed by Claude CLI to generate fix PRs, so be specific about locations and reproductions steps
