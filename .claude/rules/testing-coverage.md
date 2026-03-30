---
description: Detailed test coverage areas, mocking patterns, and testing conventions
globs:
  - "**/*.test.ts"
  - vitest.config.ts
  - src/test/**
---

# Testing Coverage & Conventions

## Framework
- Vitest with `globals: true` (no explicit imports needed)
- Config: `vitest.config.ts` -- path alias `@/` maps to `./src`
- Factories: `src/test/factories.ts` -- `buildRawEvent`, `buildCalendarEvent`, `mockUser`
- Mocking: `vi.mock("@/lib/db")` + `vi.mocked(prisma.model.method)` with `as never` for partial returns
- Convention: Test files live next to source files as `*.test.ts`

## Coverage Areas
- **Adapters:** hashnyc, Google Calendar, Google Sheets, iCal, Blogger API, London scrapers (CityH3, WLH3, LH3, BarnesH3, OCH3, SLH3, EH3), Chicago (CH3, TH3), DC (EWH3, DCH4, OFH3, Hangover), SF Bay (SFH3), Philly (BFM, HashPhilly), Texas (Brass Monkey, DFW), Upstate NY (SOH4, Halve Mein, IH3), Hockessin, Northboro, Hash Rego, Meetup, WordPress API, GenericHtml, shared utils
- **Pipeline:** merge dedup + trust levels + source-kennel guard, kennel resolution (4-stage), fingerprinting, scrape orchestration, health analysis + alerts, reconciliation, auto-issue filing, post-merge verification
- **AI:** Gemini wrapper (caching, rate-limits, grounding), parse recovery, HTML structure analysis
- **Research:** source research pipeline, server actions, HTML analysis extraction
- **Server actions:** logbook, profile, kennel subscriptions, admin CRUD, misman attendance/roster/history
- **Admin:** config validation (ReDoS), source type detection
- **Misman:** audit log, hare sync, CSV import, suggestions, verification, invites
- **Region:** CRUD, hierarchy validation, merge re-parenting, self-parent guard
- **Strava:** OAuth refresh, activity parsing, match suggestions, privacy zones
- **Utilities:** format, calendar, auth, fuzzy matching, timezone, geo, weather

## CI Enforcement
All PRs must pass `npx tsc --noEmit`, `npm run lint`, and `npm test` via `.github/workflows/ci.yml`
