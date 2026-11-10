# Design Review: "Now" List Plan

**Date:** 2026-11-10 · **Status:** approved by the owner on 2026-11-10
**Inputs:** [core-users.md](core-users.md) · design review page (claude.ai artifact "HashTracks Design Review") ·
homepage mockups (claude.ai artifact "HashTracks Homepage Mockups")

**Decided:** homepage Direction A ("search first"), and Option A for every question Q1–Q5 below.

**Goal:** more people come back regularly to find hashes and trust HashTracks as the reliable
source, especially when they don't know where to look nearby or while traveling. The "Now"
list fixes the front door so a first visit answers the visitor's question.

---

## How we'll know it worked

All numbers come from PostHog once PR #2873 (M1) is live. Take a two-week baseline before the
homepage changes ship.

| Measure | Definition | Why |
|---|---|---|
| **Weekly returning browsers** (primary) | `$pageview` with `first_visit_today = true` and `visit_recency = returning_1_7d`, summed per week, admins excluded | The goal itself: people coming back within a week |
| Daily browsers | `$pageview` with `first_visit_today = true` | Reach. The denominator for everything else |
| Searches that find something | `travel_search_results_viewed` with confirmed + likely > 0, divided by searches | An empty answer doesn't build trust |
| Homepage search use | New `home_search_submitted` event, divided by homepage first visits | Did the new front door get used? |
| Saved trips | `travel_saved_search_created` per week | Intent to come back (travelers) |

**Guardrails:** Hareline and kennel page traffic shouldn't fall, and homepage load speed
(Speed Insights LCP) shouldn't get worse.

**Targets:** set them after the baseline. Until then the bar is "the primary number goes up after
the homepage ships, and stays up for four weeks".

---

## Decisions

Each question lists the options considered. Option A was chosen for all five.

### Q1. How do we guess a visitor's area without asking?

- **Option A, chosen:** Vercel's request location headers (city plus approximate latitude
  and longitude, free, no prompt) → nearest region that has upcoming runs. A remembered area
  (`hashtracks:locationPref`, which the Kennels page already uses) overrides it. "Use my
  location" refines it.
- Option B: ask for browser location on first visit. It's precise, but a permission prompt
  before any value is shown costs trust.
- Option C: no guessing; show a world list until the visitor picks. This is today's behavior.

**Note:** the homepage is already rendered per request (it reads the Clerk user), so using
request headers doesn't break any caching. The headers are missing on localhost, so dev falls
back to Option C.

### Q2. What powers the homepage place search?

- **Option A, chosen:** reuse Travel mode's Google Places field (`DestinationInput`). It
  finds any town, including ones with no kennel (Biloxi), and it's the same component visitors
  will meet in Travel. Google bills per search session, which is negligible at today's traffic.
  Revisit if traffic grows.
- Option B: our own list of regions and kennel cities. Free and instant, but "Biloxi" finds
  nothing, which is the exact failure the review found.

### Q3. Where does a homepage search go?

- **Option A, chosen:** to Travel mode's results page, with dates defaulting to "the next
  7 days" when none are picked. Travel already has confirmed vs. likely runs, distances, weather,
  links and empty states, so it becomes the one place that answers "where and when". The
  Hareline stays the browse-everything list.
- Option B: to the Hareline filtered by region (today's "Pick a region" behavior). It has no
  distances, no confidence labels and no town search.

### Q4. What do signed-in visitors see on the homepage?

- **Option A, chosen:** the same search hero, plus a "Your week" strip of their own
  kennels' next runs where "Coming Up" is today. It falls back to runs near them when they
  follow no kennels.
- Option B: send signed-in visitors straight to the Hareline. Simpler, but it skips the search
  and the travel band.

### Q5. How far does an empty Travel search look?

- **Option A, chosen:** add a "Road trip" radius of 200 km. When a search finds no confirmed
  runs, look up to 300 km and show the three nearest confirmed runs with distance and drive
  time, under a clear "Outside your search area" label.
- Option B: just add the bigger radius, with no fallback. Visitors would still hit dead ends.

---

## The work, as pull requests

| PR | What | Size | Needs a design? | Depends on |
|---|---|---|---|---|
| **#2873** | M1: count signed-out visitors and returning visits | S | No | — |
| **PR 2** | Homepage quick fixes: local "Coming Up", live counts, visible sections | S | No | Q1 |
| **PR 3** | Travel: Road trip radius, nearest-runs fallback, coverage message | S–M | Small mockup | Q5 |
| **PR 4** | Homepage search hero and travel band | M | Done: Direction A | Q2, Q3, Q4 |

PR 2 and PR 3 don't touch the same files, so they can be built in parallel. PR 4 builds on
PR 2's location code.

### PR 2: Homepage quick fixes (F2, F5, D2)

- **Local "Coming Up":** pick runs near the visitor's area (Q1), and only runs whose start time
  hasn't passed in the kennel's own time zone (`composeUtcStart` in `src/lib/timezone.ts`).
  With no location, label the list "Around the world" so it doesn't pose as local.
- **Live counts:** replace "scraped daily from 69 sources" with the live enabled-source count.
  Make the homepage and Kennel Directory kennel totals agree (556 vs. 479 today; find out which
  filter differs).
- **Visible sections:** `FadeInSection` starts visible and animates only a small slide.
  `prefers-reduced-motion` gets no animation.
- **Done when:** seen from New York, the cards are NYC-area runs and none has already started;
  the numbers match the database; the page reads fine with JavaScript animation off.
- **Files:** `src/app/page.tsx`, `src/components/home/HeroAnimations.tsx`, a new
  `src/lib/visitor-area.ts`.

### PR 3: Travel empty results (V1, T3)

- **Road trip radius:** add 200 km to `RADIUS_TIERS` (`src/lib/travel/limits.ts`) and to
  `RADIUS_META` ("Road trip", about 125 mi).
- **Nearest-runs fallback:** when confirmed runs are 0, run a second search out to 300 km and
  show up to three confirmed runs, nearest first, with distance and drive time.
- **Coverage message:** "We may not track every kennel near Biloxi. Check Half-Mind's directory,
  or tell us about one." It links to Suggest a Kennel.
- **Done when:** Biloxi, Nov 13–16 shows the New Orleans runs about 125 km away; a city with
  runs in range shows nothing new.
- **Files:** `src/lib/travel/search.ts`, `src/components/travel/EmptyStates.tsx`,
  `src/components/travel/TravelSearchForm/types.ts`.

### PR 4: Homepage search hero and travel band (F1, F3)

- **Hero:** "Where are you hashing?" place field (Q2), optional dates, and Near me
  (`NearMeShortcut`). Submitting goes to Travel results (Q3).
- **Signed-out:** search is the primary action. Sign-up moves to a secondary link, and Travel's
  existing "Save trip" prompt asks for sign-in at the moment it's useful.
- **Signed-in:** the same hero, plus "Your week" (Q4).
- **Travel band:** "Going somewhere?" with `PopularDestinations` cards.
- **New event:** `home_search_submitted { hasDates, usedNearMe }`.
- **Done when:** a first-time visitor on a phone can search a town in one step; homepage LCP is
  no worse; signed-out visitors no longer see sign-up as the main button.
- **Files:** `src/app/page.tsx`, `src/components/home/FindRunsSection.tsx` (replaced), Travel
  components reused as-is where possible.

---

## Sequence

1. **This week:** merge #2873 and confirm in prod that `/ingest` accepts signed-out requests.
   The baseline starts.
2. **This week:** owner answers Q1–Q5 and picks a homepage mockup direction.
3. **Week 1–2:** build PR 2 and PR 3, in parallel.
4. **Week 2–3:** build PR 4 from the chosen mockup.
5. **Four weeks after PR 4:** read the measures above and decide what's next (trust line,
   calendar feed, "near you this week" default).

## Risks

- **Too little traffic to read the numbers.** With few visitors, weekly changes will be noisy.
  Read trends over four weeks, not week to week.
- **Location guesses can be wrong** (VPNs, mobile carriers). Always show the area being used
  and make it one tap to change.
- **Google Places cost** grows with traffic. Watch it in the Google Cloud console after PR 4.

## Not in this plan

These come from the review's "Next" and "Later" lists and are deliberately left out: a trust
line on every run (T1), kennel activity status (T2), town search on the Hareline (F4), "Near
you this week" as the Hareline default (R1), a calendar feed (R2), visitor info (V2), Places
you've hashed (L1), one design language (review item D1), trip alerts and weekly email
(V3, R3), big events, and kennel photos.
