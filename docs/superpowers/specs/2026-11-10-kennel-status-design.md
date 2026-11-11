# Kennel status: "Is it running?" and "What do we have?"

**Date:** 2026-11-10 · **Updated:** 2026-11-11 · **Status:** draft, revised after an adversarial
review and a builder check. The owner answered the four open questions on 2026-11-11 (recorded
below). The design as a whole is not yet approved.
**Replaces in part:** [2026-03-30-kennel-activity-status-design.md](2026-03-30-kennel-activity-status-design.md)
**Related:** [core-users.md](../../core-users.md) · [now-list-plan.md](../../now-list-plan.md)

All counts come from the August 11, 2026 local copy of the database. Re-run them on production
before building; some schedule-only kennels have gained Facebook feeds since then.

## Why

The owner's goal: more people come back regularly to find hashes and trust HashTracks as the
reliable source, especially when they don't know where to look nearby or while traveling.

The owner also wants to list the kennels Half-Mind has and we don't, even without a schedule:
"If I'm confident it's a live kennel and can link to its hareline that would be enough."

The traveler definition in `core-users.md` asks for "where the information came from, when it
was last confirmed, and a link to the kennel's own page or group." Today we can't give that
honestly. Kennel status is one verdict computed only from runs in our own data
(`src/lib/activity-status.ts`):

| Badge | Rule |
|---|---|
| (none, "active") | a run in the last 90 days, or an upcoming confirmed run |
| Possibly Inactive | last run 90–365 days ago |
| Inactive | last run 365+ days ago |
| No Data | no runs at all |

That verdict mixes up two questions: **is the kennel running?** (what a traveler needs) and
**how much of its schedule do we get?** (a fact about our coverage). The result misleads in
four ways:

- **A live kennel we can't read looks dead.** A kennel that posts only on Facebook shows
  "No Data" or "Inactive".
- **A guessed schedule looks alive.** Runs generated from a usual schedule (STATIC_SCHEDULE)
  count as runs. 37 of 422 "active" kennels were green with no real run in the 90 days either
  side of the snapshot. Upstate H3 stayed green for about two years on generated runs alone.
- **Generated runs are shown as confirmed.** 412 of the 2,377 upcoming CONFIRMED runs in the
  next 90 days (17%) come only from a generated schedule. Travel lists them under "Confirmed"
  (its confirmed-runs query in `src/lib/travel/search.ts` has no independence filter) and
  counts them as evidence when scoring predictions.
- **Old dates are anchored on future ones.** `Kennel.lastEventDate` is the latest known run,
  upcoming ones included (about 350 visible kennels). Kennel pages don't show it in that case,
  but Travel's "Last posted" line on Possible rows falls back to it (`search.ts`, around line
  825), and it stops the projection engine's inactivity downgrade from ever firing
  (`src/lib/travel/projections.ts`, around line 332).

## What other sites do

| Site | What it shows | Notes |
|---|---|---|
| Half-Mind | Alive & Verified / Unknown / Dead, plus "Last verified" and "Listing last updated" dates | Anyone submits a check with how they know and the date; an admin reviews it. No expiry. About 1,098 not-dead kennels, 559 verified in the last 90 days (Nov 2026). Its About page invites copying with credit; its homepage warns "Imported listings may be historical or unverified." It refuses plain automated requests (HTTP 406). |
| GoToTheHash genealogy | active / inactive, founding date, parent kennel | Hand-kept |
| Harrier Central, Hash Rego | no status | Posted runs speak for themselves |
| Google Maps | open / closed, kept apart from "updated by the business 3 weeks ago" | Status and freshness are separate |
| OpenStreetMap | `check_date`: when someone last confirmed the place | Freshness as a dated fact |

Worth copying: dated proof with its source, not a bare verdict. Worth avoiding: Half-Mind's
dense cards and walls of disclaimers.

## The idea

### 1. One shared definition of a "real run"

Everything below depends on one predicate, used by every place that judges activity. Today
roughly nine places compute it separately: the merge flush, the nightly backfill, the admin
refresh, the directory, the region page (twice), the share image, the homepage's
`activeKennelWhere` and the sitemap. The existing code already warns that these drift.

A run counts as **real** when it is canonical, not cancelled, and backed by a RawEvent from any
source except STATIC_SCHEDULE. It builds on the existing rule in `src/lib/event-eligibility.ts`,
with these additions:

- **Repeating calendar entries are schedules, not posts.** A Google Calendar instance of a
  repeating series that carries nothing run-specific (no hares, no run number) counts like a
  generated run. This needs the calendar's `recurringEventId` recorded on the RawEvent; the
  adapter doesn't store it today. 23 kennels have four or more upcoming calendar-only runs with
  one shared title and no details (204 for feh3). An abandoned calendar series would otherwise
  show "Next run posted" forever.
- **"Upcoming" means within 60 days.** A posted run further out (next year's campout, a far
  recurring entry) doesn't make a kennel Running on its own.
- **Events with no RawEvent** (about 16,000 of 78,000 canonical events, mostly historical
  imports): past ones count, future ones don't (my call; the builder confirms with a count).
- **Unreviewed user-submitted events** (`MANUAL` source, `isManualEntry`) don't count.
- **Logbook check-ins and misman attendance on a past run** count, because they are dated human
  evidence even when the run itself was generated.

### 2. Status states, from the newest real evidence

| State | Rule (reuses today's 90 / 365 days) |
|---|---|
| Running | a real upcoming run within 60 days, or real evidence 90 days old or newer |
| Quiet | newest real evidence 91–365 days old |
| Not seen in a year | newest real evidence over a year old, or none |
| Stopped | an admin-accepted stop report newer than any real evidence |

Evidence is a real run, an attendance record, or a dated **confirmation**. A confirmation is
one admin-entered record with a date, how they know (for example "FB event posted Oct 3",
"emailed the GM") and a link. Recording one is cheap and worth having on its own.

**Stopping a kennel** is an admin action, and it is reversible. It turns off the kennel's
STATIC_SCHEDULE sources and schedule rules, so a stopped kennel leaves the Hareline and Travel
projections too. Without this, a dead kennel keeps producing generated runs and Travel
predictions.

### 3. Generated runs stop posing as posted ones (same release)

If the status fix ships alone, Wildcard H3's card says "Not seen" while Travel lists its
Saturday run as "Confirmed". So in the same release:

- **Travel:** a run backed only by generated or repeating-calendar sources moves from
  Confirmed to Likely ("usually runs"), where projections already live. It no longer counts
  as evidence when scoring predictions.
- **Hareline:** those runs get a small "usual schedule" tag.
- **Travel "Last posted"** and the **projection inactivity downgrade** use the last real past
  run, not `lastEventDate`.

(Owner, 2026-11-11: yes, move them to Likely. Review this again after release, with live
data, to check it still makes sense.)

### 4. What cards and pages show

**Kennel card (directory, region pages):** no change for Running kennels. The existing
"Next run: Nov 15" footer already says it. For every other state, one dated line replaces
today's badge:

| State | Card line (first guess) |
|---|---|
| Quiet / Not seen in a year | "Last run we saw · Mar 2025", or "Checked running · Oct 3" when a confirmation is newer |
| No real evidence ever | "No runs seen on HashTracks · check their page ↗" |
| Stopped | "Stopped · Sep 2026" (admin-accepted only, with the source on the kennel page) |
| Listing only (phase 2) | "Half-Mind listing checked · Oct 3 · check their page ↗" |

**Kennel page:** the same line, plus a short "How we know" section: the newest few pieces of
evidence with dates and sources, and **coverage** in plain words. Coverage is based on what our
feeds actually returned in the last six months, not on which sources are linked. Linked sources
overstate it: 64 kennels with a linked real feed weren't running, and 32 had never had a real
run, for example aggregator calendars that no longer carry a kennel, or Facebook feeds that
return nothing.

- "We get their runs from Chicagoland Hash Calendar."
- "We only know their usual schedule. Check their page for actual runs."
- "We don't get their runs. Check their page ↗"

Coverage stays off the cards. Shown there, it would contradict the status line ("Posted runs ·
Not seen in a year").

**Directory "Active only" filter (on by default):** shows Running and Quiet, so the dated line
does the explaining (my call). **Homepage kennel count:** Running only.

### 5. Day one

37 kennels would leave Running: 28 that only have a generated schedule, 3 with no source, and 6
whose real feed went quiet (one is Upstate H3, with no real run since September 2024). The first
draft proposed backdating confirmations from each kennel's onboarding research. That is
dropped: no research date is stored anywhere (`Source.createdAt` is just when the seed ran),
and those dates (February–June 2026) are too old to keep anyone Running anyway.

**Owner, 2026-11-11: review those kennels by hand** (Facebook activity, websites) and record
real, dated confirmations. Do the review in the week before Status 1 ships, against production
data, so the confirmations are fresh on release day and the list matches what will actually
change.

## Phase 2: listing kennels from Half-Mind

Rethought after review. The bar stays the owner's: **confident it's live, and a link to where it
posts runs.**

- **Pull it like our other sources (owner, 2026-11-11).** Treat Half-Mind as a source the way
  we treat Harrier Central and Hash Rego: a scheduled sync into `KennelDiscovery`, with each
  kennel linking back to its Half-Mind listing as the source. The first step is to find how
  Half-Mind's own finder loads its data (perhaps a JSON endpoint, like Harrier Central's public
  API) and whether that answers ordinary requests. The anti-goal still holds: if Half-Mind's
  server refuses automated clients, we write to the maintainer instead of disguising requests
  through the stealth browser. HashTracks already sends empty Travel searches to Half-Mind's
  finder (`CoverageNote.tsx`), so the relationship is worth keeping. A short note to the
  maintainer is a courtesy either way; their About page asks only for credit.
- **Pilot one region first,** inside regions we already have (new countries need `region.ts`
  work), with every row reviewed by the owner. The discovery queue already holds 590 unreviewed
  Hash Rego rows, so a 1,700-row import without a pilot would sit unworked. Nothing is published
  from an automatic match.
- **Import bar (my guess):** "Alive & Verified", checked within 12 months, a link where runs are
  announced, a city we can map.
- **On a kennel we already have:** the Half-Mind check becomes a confirmation, credited.
- **New kennel:** a listing-only kennel. Its schedule text is shown as "Usually Saturdays 1 PM"
  but makes no schedule rules, so it never appears in Travel predictions or the Hareline. Its
  page is `noindex` and left out of the sitemap until it gets a real source, so we don't publish
  hundreds of thin copies of Half-Mind pages.
- **Credit and wording:** "Half-Mind listing checked Oct 3", linked. Not "Confirmed running":
  a Half-Mind check covers the listing details, and checkers can answer "Don't know".
- **Travel bridge (owner, 2026-11-11: yes).** When a search finds few or no runs, show "Other
  kennels near [place]" below the runs: quiet and listing-only kennels inside the search radius,
  each with its dated status line and a link to its own page, capped at five, plus a link to the
  directory. It never mixes into Confirmed / Likely / Possible. It works with kennels we already
  have, so it can ship before any Half-Mind data arrives.
- **Refresh:** re-sync verified dates on a schedule (if permitted); a Half-Mind "Dead" mark goes
  to the owner as a suggested stop, never applied automatically.

## Cut: hasher confirmations

The first draft's phase 3 (hashers confirm a kennel or report it stopped, with moderation) is
cut. `core-users.md` counts 14 accounts, 9 of which have never logged a run, so the moderation
would cost more than it brings. "This kennel stopped" reports go through the existing feedback
dialog. Revisit when there are users to supply it.

## Goals

- A traveler can tell at a glance whether a kennel is running, how we know, and where to find
  its next run.
- No live kennel looks dead just because we lack a feed.
- No kennel looks alive, and no run looks posted, just because we guessed a schedule.
- More live kennels listed, closer to Half-Mind, without listing dead ones.

## Non-goals

- Building scrapers for listing-only kennels. That stays normal onboarding.
- Kennel-officer tools (out of scope per the owner).
- Copying the rest of Half-Mind: songs, collections, rankings.
- Run dates for listing-only kennels.

## Anti-goals (failure even if it works)

- Cards that read like disclaimers, or a second line repeating what the card already says.
- Listing-only kennels crowding real runs out of search results.
- A traveler shown a dead kennel as running who turns up to an empty car park.
- Using Half-Mind's data without credit, against its maintainer's wishes, or by getting around
  its block.
- Non-runs in the Hareline.

## Constraints

- RawEvents are immutable. Schema changes go through versioned migrations. Seed changes reach
  prod only through a data migration.
- One predicate, shared by every call site (section 1).
- Half-Mind blocks plain fetches (406).
- SonarCloud and Codacy gates apply.

## Decided by the owner

- Test the split between "is it running" and "what we have" (2026-11-10). Not yet approved as
  final.
- List Half-Mind kennels we lack when confident they're live and we can link to their hareline.
- Kennel-officer tools are out of scope.

## My calls, to check

- The "real run" rules in section 1: repeating calendar entries, the 60-day upcoming limit,
  events with no RawEvent, attendance counts.
- Reuse the 90 / 365-day thresholds.
- "Active only" shows Running and Quiet; the homepage count is Running only.
- Stopping a kennel turns off its schedule sources and rules.
- Card wording above, and coverage on the kennel page only.
- The Half-Mind import bar and the one-region pilot.
- Before building, a quick mockup of the not-running card line, the kennel page "How we know"
  block, and Travel's "usual schedule" label.

## Left to the builder

The exact schema (for example a `KennelConfirmation` table, a cached last-real-run date, a
recurring marker on RawEvent), the query and caching shape, component structure, Half-Mind
matching thresholds, and how a permitted sync is scheduled.

## How we'll know it worked

- Share of kennels shown in the directory and Travel with real evidence 90 days old or newer.
- Travel "Confirmed" runs that are actually posted (target: all of them).
- Kennels listed against Half-Mind's live count.
- Clicks from a kennel page or card out to the kennel's own page (new event).
- Feedback reports of a wrong status.
- **Four weeks after Status 1 ships:** review, with live data, whether moving generated runs to
  Likely still makes sense (owner's request).

## Review notes

**Adversarial review (2026-11-10, fresh Claude reviewer; Codex isn't available on this
account).** Verdict: change before building. What changed as a result:

- A shared "real run" definition was added.
- Travel and the Hareline now label generated runs in the same release.
- The research-date seed was dropped.
- Coverage moved off the cards and is now based on what feeds return.
- Cards gained no new line for Running kennels.
- The future-date fix now targets the two places it matters.
- Phase 2 became permission-first, a one-region pilot, and `noindex`.
- Phase 3 was cut.

**Builder check.** It asked ten questions. Answered in this revision:

- stopped kennels' generated runs;
- the seed date;
- which states are "active";
- far-out and repeating runs;
- new regions;
- what counts as coverage;
- auto-matches;
- mockup first;
- other human evidence.

Contacting Half-Mind is open question 3.

## Owner answers (2026-11-11)

1. **Generated runs in Travel and the Hareline:** move them to Likely, and tag them "usual
   schedule" in the Hareline. Review again after release with real, live data.
2. **The 37 kennels that leave Running on day one:** review them by hand and record dated
   confirmations (done in the week before Status 1 ships).
3. **Half-Mind:** pull its data the way we pull Harrier Central and Hash Rego, and link back to
   it as our source. See phase 2 for how this squares with the anti-goal.
4. **Travel bridge:** yes.
