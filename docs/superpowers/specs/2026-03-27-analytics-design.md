# Analytics Design Spec

## Context

HashTracks is preparing for public promotion. Before driving traffic, we need
comprehensive analytics to understand community health, technical reliability,
product usage, and growth. The app currently has Vercel Web Analytics (unused)
and 8 custom `track()` events, plus rich operational data in the database
(attendance, subscriptions, scrape logs) that isn't surfaced in dashboards.

**Priority order:** Community health > Technical health > Product direction > Growth

## Architecture: Two Tracks

```
┌─────────────────────────────────┐  ┌──────────────────────────────────┐
│  Track 1: Behavioral Analytics  │  │  Track 2: DB-Driven Dashboards   │
│  (PostHog Cloud)                │  │  (Railway Postgres → Admin UI)   │
│                                 │  │                                  │
│  • Page views & navigation      │  │  • Kennel popularity & trends    │
│  • Feature usage events         │  │  • Regional activity heatmaps    │
│  • User funnels & retention     │  │  • User engagement metrics       │
│  • Geographic distribution      │  │  • Scrape health & fill rates    │
│  • Device & browser breakdown   │  │  • Attendance trends             │
│  • Referrer & UTM tracking      │  │  • Subscription distribution     │
└─────────────────────────────────┘  └──────────────────────────────────┘

┌─────────────────────────────────┐
│  Track 3: Error Tracking        │
│  (Sentry Cloud)                 │
│                                 │
│  • Client JS exceptions         │
│  • Server/API route errors      │
│  • Performance transactions     │
│  • Scrape adapter error context │
└─────────────────────────────────┘
```

Track 1 and Track 2 are independent and can be built in parallel.
Track 3 (Sentry) is also independent.

---

## Track 1: PostHog Integration

### Platform Choice

- **PostHog Cloud** — free open-source tier (10M events/mo)
- Replaces `@vercel/analytics` entirely
- `@vercel/speed-insights` is kept (complementary, separate concern)
- **Reverse proxy** through app domain to bypass ad blockers (Next.js rewrites)

### Privacy-First Configuration

```ts
posthog.init(POSTHOG_KEY, {
  api_host: 'https://us.i.posthog.com', // or eu.i.posthog.com
  persistence: 'memory',                 // no cookies
  disable_session_recording: true,       // no session replay
  ip: false,                             // anonymize IP after geo lookup
  // respect_dnt removed — privacy-first config (no cookies, no replay, anonymized IPs) is sufficient
  capture_pageview: false,               // manual via PostHogPageView hook
  capture_pageleave: true,               // time on page
})
```

**What this preserves:** Country, region, and city-level geographic data (derived
server-side at ingestion, raw IP discarded). Device type, browser, OS.

**What this disables:** Session replay, cross-session cookies, persistent user
identification for anonymous visitors. Logged-in users are still identified via
`posthog.identify()`.

### Ad Blocker Bypass (Reverse Proxy)

20-40% of users run ad blockers that block PostHog's default endpoint. To ensure
complete data capture, PostHog requests are proxied through the app's own domain
using Next.js rewrites:

```ts
// next.config.ts rewrites
{
  source: '/ingest/static/:path*',
  destination: 'https://us-assets.i.posthog.com/static/:path*',
},
{
  source: '/ingest/:path*',
  destination: 'https://us.i.posthog.com/:path*',
},
{
  source: '/ingest/decide',
  destination: 'https://us.i.posthog.com/decide',
},
```

The PostHog client is configured with `api_host: '/ingest'` instead of the
direct PostHog URL. This makes all tracking requests first-party, bypassing
ad blockers entirely.

### Server-Side Event Tracking

Critical events are tracked server-side via `posthog-node` in addition to
client-side, ensuring data capture even with ad blockers or JS issues:

**Server-side tracked events:**
- `check_in` — in attendance server actions
- `kennel_subscribe` / `kennel_unsubscribe` — in subscription server actions
- `signup_completed` — in Clerk webhook or auth callback
- `suggest_kennel_submit` — in suggest server action
- `feedback_submitted` — in feedback server action

**Implementation:** A server-side PostHog client singleton in `src/lib/analytics-server.ts`
using `posthog-node`, called from existing server actions. Events include
`$set` person properties for user enrichment.

**Deduplication:** Client and server may both fire for the same action. PostHog
handles this gracefully — duplicate events from the same user within a short
window are deduplicated in analysis. Alternatively, we can skip client-side
capture for events that are always server-triggered.

### Pageview Tracking

Next.js App Router can trigger multiple route changes on a single navigation.
To avoid double-counting, we disable PostHog's automatic pageview capture and
use a custom hook:

```ts
// In PostHogProvider
capture_pageview: false,  // disable auto
capture_pageleave: true,  // keep page leave

// Custom hook using usePathname() + useSearchParams()
// Fires posthog.capture('$pageview') once per route change
```

### Setup Changes

1. **Remove** `@vercel/analytics` package
2. **Remove** `<Analytics />` from `src/app/layout.tsx`
3. **Add** `posthog-js` and `posthog-node` packages
4. **Add** `<PostHogProvider>` client component wrapping the app in root layout
5. **Add** reverse proxy rewrites in `next.config.ts`
6. **Add** server-side PostHog client in `src/lib/analytics-server.ts`
7. **Add** custom pageview hook in PostHog provider
8. **Add** `posthog.identify(userId)` in auth flow after Clerk login
9. **Add** env vars: `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_API_KEY` (server-side)
10. **Migrate** 8 existing `track()` calls to PostHog equivalents
11. **Add** server-side captures in critical server actions

### Custom Events

Events organized by priority:

#### Community Health (P0)

| Event | Properties | Where |
|-------|-----------|-------|
| `hareline_view` | `tab` (list/map), `filters` (region, kennel, day) | Hareline page |
| `event_detail_view` | `kennelSlug`, `region`, `daysUntil` | Event detail page |
| `kennel_profile_view` | `kennelSlug`, `region` | Kennel profile page |
| `check_in` | `kennelSlug`, `status` (intending/confirmed) | Event detail |
| `kennel_subscribe` | `kennelSlug`, `region` | Kennel profile |
| `kennel_unsubscribe` | `kennelSlug` | Kennel profile |

#### Technical Health (P1)

Covered by Sentry (Track 3) + PostHog automatic web vitals.

#### Product Direction (P2)

| Event | Properties | Where |
|-------|-----------|-------|
| `logbook_stats_view` | `totalRuns` | Logbook stats page |
| `search_used` | `query`, `resultCount`, `context` (hareline/kennels) | Search components |
| `filter_applied` | `filterType`, `value`, `page` | Filter components |
| `near_me_used` | `distanceOption`, `resultCount` | NearMeFilter |
| `strava_connected` | — | Strava settings |
| `empty_state_shown` | `context` | EmptyState component |
| `feedback_submitted` | `category` | FeedbackDialog |

#### Growth (P3)

| Event | Properties | Where |
|-------|-----------|-------|
| `suggest_kennel` | `entryPoint`, `relationship` | SuggestKennelDialog |
| `signup_completed` | `method` (google/email) | Auth callback |

### User Identification

On Clerk login, call:
```ts
posthog.identify(userId, {
  region: user.region,           // from UserKennel or profile
  kennelCount: subscriptionCount,
  totalRuns: attendanceCount,
})
```

This enables PostHog cohort analysis (e.g., "users with 10+ runs" vs "new users").

### Migration: Existing track() Calls

| Current Vercel Event | PostHog Equivalent |
|---------------------|--------------------|
| `suggest_kennel_entry` | `suggest_kennel` (with `entryPoint`) |
| `suggest_kennel_submit` | `suggest_kennel_submit` |
| `location_prompt_shown` | `location_prompt_shown` |
| `location_prompt_action` | `location_prompt_action` |
| `region_chip_click` | `filter_applied` (with `filterType: 'region_chip'`) |
| `map_colocated_popover` | `map_colocated_popover` |
| `map_colocated_kennel_popover` | `map_colocated_kennel_popover` |
| `empty_state_shown` | `empty_state_shown` |

---

## Track 2: DB-Driven Admin Analytics Dashboard

### Location

New admin page: `/admin/analytics`

### Data Source

All queries against existing Prisma models — no new tables needed.

### Chart Library

`recharts` — lightweight, React-based, widely used in Next.js apps.

### Dashboard Sections

#### Community Health

- **Active kennels by region** — Kennels with events in last 30/60/90 days,
  grouped by region. Bar chart.
- **Kennel popularity ranking** — Top 20 kennels by attendance count and by
  subscription count. Sortable table.
- **Regional growth** — New users by region over time (monthly). Area chart.
- **Attendance trends** — Weekly/monthly check-in volume, with trend line.
  Line chart.
- **Engagement ratio** — Check-ins per event by kennel (top/bottom). Bar chart.

#### User Engagement

- **User summary cards** — Total users, new this week, new this month,
  active (logged in last 30 days).
- **Activation rate** — Users with 1+ check-in vs. zero. Donut chart.
- **Subscription distribution** — Histogram of kennels-per-user.
- **Misman adoption** — Kennels with active misman / total visible kennels.

#### Operational Health

- **Source health summary** — Healthy / degraded / failing by region. Stacked bar.
- **Scrape success rate** — 7-day rolling success %. Line chart.
- **Fill rate trends** — Average fill rates for title, location, hares,
  startTime over time. Multi-line chart.
- **Stale sources** — Sources with no successful scrape in 7+ days. Table.

### Server Actions

New file: `src/app/admin/analytics/actions.ts`

Each dashboard section gets a server action returning aggregated data:
- `getCommunityHealthMetrics()`
- `getUserEngagementMetrics()`
- `getOperationalHealthMetrics()`

Queries use Prisma `groupBy`, `count`, `aggregate` — no raw SQL needed for
the initial version.

### UI Design

The dashboard page will use the `/frontend-design` skill for high-quality
visual design. Key requirements:
- Consistent with existing admin UI (Tailwind + shadcn/ui)
- Responsive — usable on tablet for checking at events
- Time period selector (7d / 30d / 90d / all time)
- Section tabs or scroll-based navigation

---

## Track 3: Sentry Integration

### Platform Choice

- **Sentry Cloud** — free tier for open-source (5K errors/mo)
- Next.js SDK with automatic instrumentation

### Setup

1. **Add** `@sentry/nextjs` package
2. **Create** `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
3. **Wrap** `next.config.ts` with `withSentryConfig()`
4. **Add** env vars: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (build-time for source maps)
5. **Add** `instrumentation.ts` for server-side initialization (Next.js 16 convention)

### Automatic Captures

- Unhandled client JS exceptions
- Server-side errors in API routes and server actions
- React error boundary crashes
- Performance transactions (slow routes)

### Custom Context

- Tag errors with `kennelSlug`, `sourceId`, `region` where available
- Tag scrape adapter errors with adapter type and source URL
- Set user context on login: `Sentry.setUser({ id: userId })` — no PII

### Complementary to Existing Alerts

The existing `Alert` model tracks scrape-pipeline-level failures.
Sentry tracks application-level errors. No overlap — they're complementary.

---

## Environment Variables (New)

```
NEXT_PUBLIC_POSTHOG_KEY=         # PostHog project API key (browser-exposed)
POSTHOG_API_KEY=                 # PostHog server-side API key (NOT browser-exposed)
SENTRY_DSN=                      # Sentry DSN (used client + server)
SENTRY_AUTH_TOKEN=               # Sentry auth token (build-time only, for source map upload)
SENTRY_ORG=                      # Sentry organization slug (build-time)
SENTRY_PROJECT=                  # Sentry project slug (build-time)
```

Note: `NEXT_PUBLIC_POSTHOG_HOST` is not needed — the reverse proxy uses `/ingest`
as the host, which is a relative path requiring no env var.

Note: `SENTRY_AUTH_TOKEN` must be added to Vercel's environment variables for
builds, scoped to Production + Preview environments.

---

## What We Remove

- `@vercel/analytics` package
- `<Analytics />` component from root layout
- All `import { track } from "@vercel/analytics"` calls (replaced with PostHog)

## What We Keep

- `@vercel/speed-insights` and `<SpeedInsights />` (complementary)
- Existing admin dashboard at `/admin` (the 8-metric summary stays)
- Existing `Alert` model and pipeline (complementary to Sentry)

---

## Verification Plan

### PostHog
1. Visit app locally, check PostHog dashboard for page view events
2. Trigger each custom event, verify it appears in PostHog Live Events
3. Log in as test user, verify `identify()` sets person properties
4. Check geographic data appears (country/city) from production deploy
5. Confirm no cookies are set (privacy-first config)

### Sentry
1. Trigger a test error in dev, verify it appears in Sentry dashboard
2. Verify source maps are uploaded during Vercel build
3. Confirm server-side errors (API route) are captured
4. Verify user context is attached after login

### DB Dashboard
1. Verify each chart loads with real data from Railway Postgres
2. Test time period selector (7d / 30d / 90d / all)
3. Verify queries perform acceptably (< 2s for each section)
4. Test responsive layout on tablet viewport

### Migration
1. Verify all 8 existing `track()` calls are replaced
2. Confirm `@vercel/analytics` is fully removed from bundle
3. Run `npm test` to ensure no broken imports
