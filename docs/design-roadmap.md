# Design Roadmap: HashTracks Visual Identity & Experience

**Date:** March 8, 2026
**Status:** Planning

---

## Vision

HashTracks has strong information architecture and powerful functionality, but the visual design reads as a functional prototype — default component library styling with minimal personality. For a community platform built around an irreverent, social, tribal culture, the design should **feel like hashing**, not like a SaaS dashboard.

The goal is to evolve HashTracks from "it works" to "it feels like home" — giving the platform a distinctive visual identity that reflects the energy and culture of the hashing community while maintaining the clean usability that's already in place.

---

## Design Priorities (Ranked by Impact)

### 1. Homepage / Landing Page
**Impact:** Highest — first impression, conversion driver
**Status:** Not started

The current homepage is minimal: centered text, a few event preview cards, and two buttons. For a platform with 1,100+ events across 145 kennels in 43 regions, this should be a compelling pitch that immediately communicates value.

**Goals:**
- Bold visual hook that captures the energy of hashing
- Clear value proposition for new visitors (what is this? why do I need it?)
- Social proof (stats, activity, geographic reach)
- Distinct sections for the three core experiences: Discover (Hareline), Track (Logbook), Connect (Kennels)
- Strong CTAs that drive sign-up and exploration
- Mobile-first responsive design

---

### 2. Hareline Event Cards
**Impact:** Highest frequency — the #1 daily touchpoint
**Status:** Not started

Event cards are functional but flat — white rounded rectangles with text. More visual hierarchy, better color use, and subtle interaction design would make the daily experience feel alive.

**Goals:**
- Stronger visual hierarchy (kennel name, time, and title should scan instantly)
- Better use of region colors beyond the small badge
- "Going" / RSVP status more prominent
- Hover/tap states with personality
- Weather integration visual treatment
- Location preview without requiring click-through

---

### 3. Kennel Profile Pages
**Impact:** High — the "club homepage" for each kennel
**Status:** Not started

Currently a plain text layout with info card, description, and event list. For kennels with decades of history, these should feel like living club pages.

**Goals:**
- Hero section with visual identity (logo if available, region color theming)
- Stats presented as achievements, not plain text
- Activity timeline / heatmap showing run frequency
- Social links with better visual treatment
- Upcoming vs. past events with clearer visual separation
- Subscriber count as social proof

---

### 4. Logbook & Personal Stats
**Impact:** High — the "Strava" emotional payoff
**Status:** Not started

The logbook is currently a data table. For the "Strava of Hashing" positioning, this should be the personal reward — visualizations of your hashing journey that make you feel accomplished and want to share.

**Goals:**
- Activity heatmap (GitHub-style contribution graph or calendar heat map)
- Streak tracking with visual indicators
- Milestone celebrations (animated badges at 25, 50, 100, etc.)
- Per-kennel breakdown visualization (pie/bar chart)
- Year-in-review summary stats
- Shareable stats card (social media export)

---

### 5. Navigation & Global Chrome
**Impact:** Medium — affects every page, sets overall tone
**Status:** Not started

The nav is text-only links with no logo/wordmark. A stronger header sets the tone for the entire product.

**Goals:**
- Logo / wordmark design (even text-based with personality)
- More considered header design (spacing, hierarchy)
- Mobile bottom navigation for thumb-friendly access
- User avatar / profile quick-access refinement
- Consistent page header treatment across all pages
- Footer with personality (not just copyright text)

---

### 6. Empty States & Onboarding
**Impact:** Medium — critical for new user retention
**Status:** Not started

"No upcoming events" and similar empty states need designed treatments that guide users toward action.

**Goals:**
- Illustrated or stylized empty states for each context
- New user onboarding flow (subscribe to kennels, set home region)
- First-run guidance on Hareline (explain filters, views)
- Logbook zero-state that motivates first check-in

---

## Design Principles

1. **Culture-forward** — The design should reflect hashing culture: irreverent, social, outdoorsy, beer-adjacent. Not corporate, not clinical.
2. **Data-rich, not data-heavy** — Show the depth of information without overwhelming. Progressive disclosure.
3. **Color with purpose** — Region colors are already a strong system. Extend them intentionally rather than adding competing palettes.
4. **Motion as delight** — Subtle animations on key moments (check-in, milestone hit, RSVP) create emotional reward.
5. **Mobile-native thinking** — Most hashers will check this on their phone before/after a run. Touch targets, thumb zones, and quick glance-ability matter.

---

## Implementation Notes

- Framework: Next.js 16 App Router + Tailwind CSS + shadcn/ui
- Animation: CSS transitions for simple states; consider Framer Motion for milestone celebrations
- Fonts: Current system/default fonts should be replaced with a distinctive pairing
- Icons: Currently using Lucide via shadcn — may want to supplement with custom iconography for hash-specific concepts
