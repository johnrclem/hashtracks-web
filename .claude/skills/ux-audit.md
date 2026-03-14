---
description: Comprehensive UX audit methodology for HashTracks pre-launch review
globs:
  - src/components/**
  - src/app/**/page.tsx
---

# UX Audit — HashTracks Pre-Launch

Comprehensive UX audit methodology for HashTracks. When auditing, follow this checklist systematically across all user-facing pages.

## Audit Scope

### 1. Page-by-Page Walkthrough
Visit every page and document issues:
- `/` (landing/home)
- `/hareline` (event calendar — List, Calendar, and Map tabs)
- `/hareline/[eventId]` (event detail — click into several events)
- `/kennels` (kennel directory, including map view)
- `/kennels/[slug]` (kennel profile — check several)
- `/logbook` (personal logbook — if signed in, click into events to edit participation level and strava matching)
- `/sign-in` and `/sign-up`
- `/profile` (if signed in)
- `/misman` (if signed in)
- `/admin` (if signed in)

### 2. Mobile vs Desktop Consistency
For each page, resize to mobile width (~375px) AND desktop (~1280px). Flag:
- Layout breaks, overflow, horizontal scroll
- Touch targets too small (<44px)
- Text truncation that hides important info
- Bottom nav behavior and active state accuracy
- Content that's visible on desktop but missing on mobile (or vice versa)

### 3. Data Presentation Consistency
Look at how events display across different views and flag inconsistencies:
- **Event cards:** Do all events show kennel name, date, title, location, time in the same format? Are there events with missing data that look broken vs gracefully handled?
- **Location display:** Are locations formatted consistently? Any duplicated city names, "TBA" showing up, URLs in location fields, or concatenated addresses?
- **Titles:** Any events showing raw kennel abbreviations as titles instead of meaningful names? Admin text like "Hares needed"? HTML entities showing as literal text (`&amp;`, `&apos;`)?
- **Times:** Consistent AM/PM formatting? Any clearly wrong times (11:45 PM for a daytime hash)?
- **Hares:** Names showing as concatenated without spaces? Placeholder text like "TBD" or "needed"?
- When there are event-level data issues, click through to the data source and try to capture what the values should be

### 4. Filter & Search UX
Test all filter controls on `/hareline` and `/kennels`:
- Do filters persist when navigating away and back?
- Do filters persist in the URL (shareable links)?
- Is the filter UI consistent between hareline and kennel directory?
- Do "clear filters" / reset controls work?
- Are filter labels clear and unambiguous?
- Does the date range / density picker work correctly?
- On mobile, are filters accessible without excessive scrolling?

### 5. Interactive Elements
Test all clickable/tappable elements:
- Event cards → detail page navigation
- Kennel badges → kennel profile navigation
- "I'm Going" / check-in buttons (if signed in)
- Calendar export (Google Calendar, .ics download)
- Map pins → event/kennel popups
- External links (source URLs, Google Maps links)
- Sort controls, pagination, view toggles

### 6. Visual & Theming Consistency
- Font consistency (Outfit headings, JetBrains Mono body?)
- Color palette consistency across pages
- Spacing/padding consistency between cards, sections, pages
- Dark mode support (if any) — or does it need one?
- Loading states: are skeleton loaders used consistently?
- Empty states: what happens with no results for a filter?
- Error states: what happens with broken data?

### 7. Accessibility Quick Check
- Can you tab through interactive elements in logical order?
- Do images have alt text?
- Is there sufficient color contrast on text?
- Are form labels associated with inputs?
- Do tooltips/popovers have keyboard access?

### 8. Performance Observations
- Any pages that feel slow to load?
- Images/maps that take too long to render?
- Jank during scrolling on long event lists?

## Output Format

Organize findings by severity:

**P0 — Broken:** Features that don't work, data that's wrong, crashes
**P1 — Confusing:** UX that would confuse a new user or make them lose trust
**P2 — Inconsistent:** Things that work but look different across views/pages
**P3 — Polish:** Minor visual nits, spacing issues, "nice to have" improvements

For each finding, include:
- **Page/URL:** Where you found it
- **Viewport:** Mobile or desktop (or both)
- **Description:** What's wrong
- **Screenshot:** If possible
- **Expected:** What it should look like/do instead

## Tech Stack Context
- **UI Framework:** shadcn/ui components (`src/components/ui/`)
- **Styling:** Tailwind CSS
- **Auth:** Clerk (sign-in/sign-up flows)
- **Maps:** Google Maps (@vis.gl/react-google-maps)
- **Key pages:** Hareline (calendar), Kennel Directory, Logbook, Misman attendance, Admin dashboard
