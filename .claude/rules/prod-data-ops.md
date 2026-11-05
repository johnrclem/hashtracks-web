---
description: Rules for prod data writes — backfills, cleanups, restores, source config changes (Nov 2026 triage lessons)
globs:
  - scripts/**
  - prisma/migrations/**
  - prisma/seed-data/**
  - src/pipeline/reconcile.ts
---

# Prod Data Operations

Lessons from the Nov 2026 maintenance triage. Every rule here comes from a real incident.

## Before any write
- **Dry run first, show counts, get the owner's OK.** This applies to backfills, cleanups,
  restores and one-shot UPDATEs. A migration counts as a write: dry-run it against prod inside
  `BEGIN; … ROLLBACK;` and report the per-statement row counts.
- **A preview must show where each event will be filed, not just how many dates are new.** A
  wide GCal backfill whose preview counted only new (kennel, date) slots filed ~1,100 sibling
  kennels' runs under OH3. The source's `defaultKennelTag` caught everything that matched no
  pattern. For any multi-kennel source, preview per-kennel counts and sample titles from the
  default bucket. Fix routing first (`strictKennelRouting: true`, or sibling patterns), then
  backfill.
- **Re-attribute misrouted history; don't delete it** if the right kennel exists in HashTracks
  (see memory `feedback_aggregator_misroute_reassign_not_insert`).

## Writing
- **Long-running scripts need a long transaction timeout.** Prisma's interactive `$transaction`
  defaults to 5 s. A 1,112-row delete hit P2028 at 76 s and rolled back. Pass
  `{ timeout: 600_000, maxWait: 60_000 }`.
- Scripts using `createScriptPool` need `BACKFILL_ALLOW_SELF_SIGNED_CERT=1` against Railway.
- One-shot scripts never import `prisma/seed.ts`, because it runs a full seed on import.
  Importing `prisma/seed-data/*` is safe; those files are plain data.

## Reconcile and forward-only sources
- **A source whose fetch drops past runs needs `upcomingOnly: true`.** That covers Harrier
  Central `getEvents`, logged-out Meetup, "upcoming runs" HTML pages, rolling iCal windows, and
  forward-only adapters. Without it, reconcile cancels every run once it has happened. Phoenix,
  Sydney Thirsty, LSW and Sacramento hit this, and a prod sweep on 2026-11-05 found 65 sources
  with past runs cancelled after their dates.
- **Restoring wrongly cancelled runs:** skip any row whose (kennel, date) or run number already
  has a CONFIRMED event, since that is a reschedule or duplicate. Never touch admin-cancelled
  rows. `scripts/uncancel-stale-by-source.ts` only accepts events with 2+ RawEvents, but a
  RawEvent is added only when data changes, so single-RawEvent rows are equally real.
  Restore only **after** the `upcomingOnly` migration is live, or the next scrape re-cancels.
- **Year-less upcoming pages can keep stale past rows.** "First row's month < this month ⇒ next
  year" turns already-run rows into next-year phantoms (Hash House Horrors, Nov 2026). Anchor
  years on run numbers: anchor run + Δrun × cadence (memory `reference_runnumber_anchored_year_inference`).

## After merging
- **Verify in prod with a scrape**, not only locally: `POST https://www.hashtracks.xyz/api/cron/scrape/<sourceId>`
  with `Authorization: Bearer $CRON_SECRET`, then read the new `ScrapeLog` row.
- **Re-check fixed sources after a day** of scheduled scrapes. Egress-dependent fixes (Atlanta,
  Bangkok) can regress when a proxy exit IP rotates.
- Seed changes reach prod only through a data migration. Vercel runs `migrate deploy` and never
  `db seed`.
