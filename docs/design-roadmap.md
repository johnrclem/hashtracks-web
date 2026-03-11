# Design Roadmap: HashTracks Visual Identity & Experience

**Date:** March 8, 2026 (updated March 11, 2026)
**Status:** 4 of 6 items shipped, 2 in progress

---

## Vision

HashTracks has strong information architecture and powerful functionality, but the visual design reads as a functional prototype — default component library styling with minimal personality. For a community platform built around an irreverent, social, tribal culture, the design should **feel like hashing**, not like a SaaS dashboard.

The goal is to evolve HashTracks from "it works" to "it feels like home" — giving the platform a distinctive visual identity that reflects the energy and culture of the hashing community while maintaining the clean usability that's already in place.

---

## Design Priorities (Ranked by Impact)

### 1. Homepage / Landing Page ✅
**Impact:** Highest — first impression, conversion driver
**Status:** Shipped (PR #205)

Animated counters, feature sections, region ticker, live event feed. Added /about page and /for-misman landing page with misman teaser on homepage. All original goals met.

**Shipped:**
- [x] Bold visual hook that captures the energy of hashing
- [x] Clear value proposition for new visitors (what is this? why do I need it?)
- [x] Social proof (stats, activity, geographic reach)
- [x] Distinct sections for the three core experiences: Discover (Hareline), Track (Logbook), Connect (Kennels)
- [x] Strong CTAs that drive sign-up and exploration
- [x] Mobile-first responsive design

---

### 2. Hareline Event Cards ✅
**Impact:** Highest frequency — the #1 daily touchpoint
**Status:** Shipped (PR #219)

Region-colored accents, gradient washes, RSVP glow indicators, hover animations, weather forecasts. RSVP color constants polished, weather API hardened. All original goals met.

**Shipped:**
- [x] Stronger visual hierarchy (kennel name, time, and title should scan instantly)
- [x] Better use of region colors beyond the small badge
- [x] "Going" / RSVP status more prominent
- [x] Hover/tap states with personality
- [x] Weather integration visual treatment
- [x] Location preview without requiring click-through

---

### 3. Kennel Profile Pages ✅
**Impact:** High — the "club homepage" for each kennel
**Status:** Shipped (PR #210)

Hero section with region-colored theming + logo/initials fallback, trail location heatmap (Strava-style), achievement-style animated stats, unified QuickInfoCard with social links, EventTabs for upcoming/past. All original goals met.

**Shipped:**
- [x] Hero section with visual identity (logo if available, region color theming)
- [x] Stats presented as achievements, not plain text
- [x] Activity timeline / heatmap showing run frequency
- [x] Social links with better visual treatment
- [x] Upcoming vs. past events with clearer visual separation
- [x] Subscriber count as social proof

---

### 4. Logbook & Personal Stats 🔄
**Impact:** High — the "Strava" emotional payoff
**Status:** In progress (PR #211)

Animated bar charts (day-of-week + year-by-year), milestone icons with progress bars, stacked participation bar, region-colored borders.

**Shipped:**
- [x] Milestone celebrations (animated badges at 25, 50, 100, etc.)
- [x] Per-kennel breakdown visualization (pie/bar chart)

**Remaining:**
- [ ] Activity heatmap (GitHub-style contribution graph or calendar heat map)
- [ ] Streak tracking with visual indicators
- [ ] Year-in-review summary stats
- [ ] Shareable stats card (social media export)

---

### 5. Navigation & Global Chrome ✅
**Impact:** Medium — affects every page, sets overall tone
**Status:** Shipped (PRs #214, #216, #218, #226)

Admin pill nav with icons, misman pill nav with icons + mobile active dot, header updated with Misman link visible to all and /about link. Outfit + JetBrains Mono fonts, Wordmark component, PageHeader standardization, mobile bottom nav (replaces hamburger), 3-column footer. All original goals met.

**Shipped:**
- [x] More considered header design (spacing, hierarchy)
- [x] User avatar / profile quick-access refinement
- [x] Logo / wordmark design (even text-based with personality)
- [x] Mobile bottom navigation for thumb-friendly access
- [x] Consistent page header treatment across all public pages
- [x] Footer with personality (not just copyright text)

---

### 6. Empty States & Onboarding 🔄
**Impact:** Medium — critical for new user retention
**Status:** In progress (PR #218)

Admin empty states standardized across RequestQueue, MismanRequestQueue, RosterGroupsAdmin.

**Shipped:**
- [x] Standardized empty states for admin pages

**Remaining:**
- [ ] Illustrated or stylized empty states for public pages
- [ ] New user onboarding flow (subscribe to kennels, set home region)
- [ ] First-run guidance on Hareline (explain filters, views)
- [ ] Logbook zero-state that motivates first check-in

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
