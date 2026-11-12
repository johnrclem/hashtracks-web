# Kennel Status 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-verdict kennel activity badge with status built from the newest real, dated evidence. Stop runs generated from a usual schedule from posing as posted runs in Travel and the Hareline. Give admins dated confirmations and a reversible "stopped" action.

**Architecture:** Classification happens once and is cached.
- `Event.isScheduleOnly` marks events backed only by schedule projections.
- Four cached `Kennel` evidence dates (`lastRunSeenAt`, `nextRunPostedAt`, `lastConfirmedAt`, `stoppedAt`) are refreshed by two SQL functions, run after every scrape and nightly.
- A pure client-safe module (`src/lib/kennel-status.ts`) turns those dates into a state and a one-line status for every display surface.

The work ships as two PRs:
- **PR A** (Tasks 1–7): data, admin tools and a review script. No public change.
- **PR B** (Tasks 8–11): every user-facing change, in one release, after the owner's hand review.

**Tech Stack:** Next.js 16 App Router, Prisma 7 / Postgres (raw SQL via `$executeRaw`), Vitest, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-10-kennel-status-design.md` (sections 1–5; phase 2 is out of scope)

**Base:** `main` after #2901 (homepage search) merges, because Task 8 edits the homepage count it touches.

## Global Constraints

- **Schedule-only event:** has ≥1 RawEvent, and every RawEvent is either from a `STATIC_SCHEDULE` source or a repeating Google Calendar instance (`rawData.recurringSeriesId` set) with no hares and no run number. An event with no RawEvent is never schedule-only.
- **Real run (evidence):** canonical, status ≠ `CANCELLED`, not schedule-only, `isManualEntry` false. A future-dated one must also have ≥1 RawEvent.
- **Attendance evidence:** an `Attendance` with status `CONFIRMED`, or any `KennelAttendance`, on a canonical, non-cancelled event dated today or earlier. It counts toward `lastRunSeenAt` even when the event is schedule-only.
- **Co-hosts count:** evidence joins through `EventKennel`, the same as `backfill-last-event.ts`.
- **States** (dates are UTC noon; "today" is today's UTC noon):
  - **running:** `nextRunPostedAt` in [today, today+60], or newest evidence ≥ today−89 (today counts as day 1, matching today's `activeSinceUtcNoon`);
  - **quiet:** newest evidence in [today−364, today−90];
  - **not-seen:** older evidence, or none;
  - **stopped:** `stoppedAt` is set.
  - **Newest evidence** = latest of `lastRunSeenAt`, `lastConfirmedAt`, and `nextRunPostedAt` when it is ≤ today.
- **Stop invariant:** `stoppedAt` is non-null only while the newest un-reverted `STOPPED` confirmation is later than all evidence. The refresh clears it when newer evidence arrives, because kennels restart.
- **Copy, exact strings:**
  - `Last run we saw · {d}`
  - `Checked running · {d}`
  - `Next run posted · {d}`
  - `No runs seen on HashTracks`, plus ` · check their page ↗` when a website or Facebook link exists
  - `Stopped · {d}`
  - `Usual schedule`, the Hareline chip
  - `Usual schedule: {date}`, the directory footer for a schedule-only next run
  - `{d}` = `MMM d` when in the current year, else `MMM yyyy`.
- **Coverage copy, exact strings:**
  - `We get their runs from {source names}.`
  - `We only know their usual schedule. Check their page for actual runs.`
  - `We don't get their runs. Check their page ↗`
- **Migrations:** schema changes only, authored with `npm run prisma -- migrate dev --name kennel_status_evidence` against the local DB. The migration carries no data backfill: the refresh functions fill the new columns.
- **PR A** changes nothing a visitor can see.
- **Tests in this worktree** need the temporary `vitest.local.config.ts` (worktree exclude removed). Delete it before committing.
- **Sonar/Codacy:** no `new RegExp(variable)` and no regex with nested `\s*` alternation.

## Review Focus

1. **A kennel whose only upcoming real run is more than 60 days out** (an annual campout, Leap Year H3's Feb 29 2028), with no other recent evidence, must not be running, and its line reads `Next run posted · {d}`. *Test: Task 5.*
2. **A stopped kennel that later posts a real run** is running again after the next refresh. Its schedule sources stay off until an admin restarts it. *Check: Task 3, local-DB verification.*
3. **A kennel whose only recent run is co-hosted** (EventKennel secondary) is running. *Check: Task 3, local-DB verification.*
4. **A directory card whose next event is schedule-only** shows `Usual schedule: …`, not `Next run: …`. *Test: Task 8.*
5. **Stopping a kennel whose STATIC_SCHEDULE source also feeds another kennel** must leave that source enabled. *Test: Task 6.*

---

## PR A: evidence data and admin tools (no public change)

### Task 1: Schema for schedule-only events, kennel evidence and confirmations

**Files:**
- Modify: `prisma/schema.prisma` (models `Event`, `Kennel`, `User`; new enum + model)
- Create: `prisma/migrations/<ts>_kennel_status_evidence/migration.sql` (generated)

**Interfaces:**
- Produces:
  - `Event.isScheduleOnly Boolean @default(false)`
  - `Kennel.lastRunSeenAt DateTime?`
  - `Kennel.nextRunPostedAt DateTime?`
  - `Kennel.lastConfirmedAt DateTime?`
  - `Kennel.stoppedAt DateTime?`
  - `Kennel.confirmations KennelConfirmation[]`
  - `enum KennelConfirmationKind { RUNNING STOPPED }`
  - `model KennelConfirmation`, with these fields:
    - `id`, `kennelId`;
    - `kind`;
    - `observedAt DateTime` (UTC noon);
    - `note String`;
    - `url String?`;
    - `createdById String` (relation to `User`, back-relation `kennelConfirmations` on `User`);
    - `disabledSourceIds String[] @default([])`;
    - `deactivatedRuleIds String[] @default([])`;
    - `revertedAt DateTime?`;
    - `createdAt`;
    - `@@index([kennelId, kind, observedAt])`.
  - `Event` gets `@@index([kennelId, isScheduleOnly])` only if the generated plan for Task 3's query needs it (builder's call after `EXPLAIN` on the local DB).

- [ ] **Step 1:** Edit the schema with a one-line comment on each new field, saying what it caches and who writes it (Task 3's refresh, Task 6's actions).
- [ ] **Step 2:** Run `npm run prisma -- migrate dev --name kennel_status_evidence`. Expected: a new migration directory containing only `ALTER TABLE` / `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX`. Read the SQL.
- [ ] **Step 3:** Run `npx tsc --noEmit`. Expected: passes.
- [ ] **Step 4:** Commit the schema and migration: `feat(kennel-status): schema for schedule-only events, kennel evidence and confirmations`.

### Task 2: Mark repeating Google Calendar instances

**Files:**
- Modify: `src/adapters/types.ts` (`RawEventData`)
- Modify: `src/adapters/google-calendar/adapter.ts` (`buildRawEventFromGCalItem`, return object near line 2189)
- Modify: `src/pipeline/fingerprint.ts`
- Test: `src/adapters/google-calendar/adapter.test.ts`, `src/pipeline/fingerprint.test.ts`

**Interfaces:**
- Produces: `RawEventData.recurringSeriesId?: string`, the GCal `recurringEventId` when the item is an instance of a repeating event, else undefined. Task 3's SQL reads it as `rawData->>'recurringSeriesId'`.

- [ ] **Step 1: Write failing tests.**
  - `adapter.test.ts`:
    - `"sets recurringSeriesId from an instance's recurringEventId"`: build from an item with `recurringEventId: "abc"`; expect `raw.recurringSeriesId === "abc"`.
    - `"leaves recurringSeriesId undefined for one-off events"`.
  - `fingerprint.test.ts`:
    - `"fingerprint is unchanged when recurringSeriesId is undefined"`: compare against the fingerprint of the same data built before the change, using an existing fixture.
    - `"fingerprint changes when recurringSeriesId is set"`.
- [ ] **Step 2:** Run `npx vitest run --config vitest.local.config.ts src/adapters/google-calendar src/pipeline/fingerprint.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Copy `item.recurringEventId` into the raw.
  - In `generateFingerprint`, add a gated spread `...(data.recurringSeriesId === undefined ? [] : [data.recurringSeriesId])`, the same pattern and comment style as `locationStreet`. Only repeating instances re-fingerprint, which is a one-time re-merge wave for those rows.
  - Check that `mergeRawEventInPlace` / `dedupGCalEvents` keep the field when they merge two raws: the target keeps its own value.
- [ ] **Step 4:** Run the same command. Expected: PASS, and the full `src/adapters` suite passes.
- [ ] **Step 5: Live verification** (`.claude/rules/live-verification.md`). Call the adapter's `fetch` for the Fort Eustis H3 Google Calendar source with `{ days: source.scrapeDays }`.
  - Expected: events are returned, and most upcoming feh3 events carry `recurringSeriesId`. In the August snapshot, 204 had one title and no hares or run number.
  - Log the count with the field set and one sample.
- [ ] **Step 6:** Commit: `feat(gcal): record recurringSeriesId on repeating calendar instances`.

### Task 3: Refresh schedule-only flags and kennel evidence

**Files:**
- Create: `src/pipeline/kennel-evidence.ts`
- Test: `src/pipeline/kennel-evidence.test.ts`

**Interfaces:**
- Consumes: Task 1's columns, and Task 2's `rawData.recurringSeriesId`.
- Produces:
  - `refreshScheduleOnlyFlags(scope: "all" | { sourceId: string; since: Date }): Promise<number>`, the number of events whose flag changed. The source scope covers events linked to that source's RawEvents with `scrapedAt >= since`.
  - `refreshKennelEvidence(kennelIds?: string[], now?: Date): Promise<number>`, the number of kennels changed. With no ids it refreshes every kennel.
  - Both write only rows whose value changes (`IS DISTINCT FROM`).

- [ ] **Step 1: Write failing tests,** mocking `prisma.$executeRaw` as in `src/pipeline/backfill-last-event.test.ts`, and introspecting the tagged-template SQL strings.
  - `"refreshScheduleOnlyFlags treats STATIC_SCHEDULE and detail-less repeating instances as schedule"`: the SQL contains `'STATIC_SCHEDULE'`, `recurringSeriesId`, `'hares'` and `'runNumber'`.
  - `"refreshScheduleOnlyFlags never flags an event with no RawEvent"`: the SQL requires `EXISTS` over `"RawEvent"`.
  - `"refreshScheduleOnlyFlags scopes to one source's rows scraped since a time"`: with a source scope, the `sourceId` and `since` values are passed as parameters.
  - `"refreshKennelEvidence counts co-hosted runs and attendance"`: the SQL contains `"EventKennel"`, `"Attendance"` and `"KennelAttendance"`.
  - `"refreshKennelEvidence excludes schedule-only, cancelled and manual events from runs"`.
  - `"refreshKennelEvidence clears stoppedAt when newer evidence exists"`: the SQL compares the stop's `observedAt` against the evidence dates and filters `"revertedAt" IS NULL`.
  - `"refreshKennelEvidence passes kennel ids when given"`.
  - `"both return the affected-row count"`.
- [ ] **Step 2:** Run `npx vitest run --config vitest.local.config.ts src/pipeline/kennel-evidence.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** with one shared SQL fragment for "this RawEvent is a posted run", using the Global Constraints definitions. `refreshKennelEvidence` computes, per kennel:
  - **`lastRunSeenAt`:** the later of the max real past run date and the max attended past event date;
  - **`nextRunPostedAt`:** the min real run date on or after today that has ≥1 RawEvent;
  - **`lastConfirmedAt`:** the max `observedAt` of `RUNNING` confirmations;
  - **`stoppedAt`:** the newest un-reverted `STOPPED` `observedAt`, but only when it is later than all three dates above; otherwise null.
- [ ] **Step 4:** Run the test command. Expected: PASS.
- [ ] **Step 5: Verify against the local DB** (`hashtracks_dev`). Write a throwaway scratch script, not committed. Run inside `BEGIN … ROLLBACK`: `refreshScheduleOnlyFlags("all")`, then `refreshKennelEvidence()`, then report:
  - events flagged schedule-only (expect ≈ the 412 generated-only upcoming runs plus past ones);
  - kennels by state, using Task 5's rules in SQL or by loading rows;
  - one co-host-only kennel shown as running (Review Focus 3);
  - an inserted `STOPPED` confirmation dated before the kennel's last real run, with `stoppedAt` null after refresh (Review Focus 2).

  Paste the counts into the PR description.
- [ ] **Step 6:** Commit: `feat(kennel-status): refresh schedule-only flags and kennel evidence`.

### Task 4: Run the refresh after scrapes and nightly

**Files:**
- Modify: `src/pipeline/scrape.ts` (after the reconcile block that starts around line 596)
- Modify: `src/app/api/cron/audit/route.ts` (next to `backfillLastEventDates`)
- Modify: `src/app/admin/kennels/backfill-last-event-action.ts`
- Test: `src/pipeline/scrape.test.ts`. The audit route has no test file; its two-line change is checked by reading.

**Interfaces:**
- Consumes: Task 3's two functions.
- Produces: nothing new. After every successful scrape, the source's flags and its linked kennels' evidence are current. Nightly, everything is.

- [ ] **Step 1: Write failing tests.**
  - `"scrapeSource refreshes schedule-only flags for this source since the scrape started, then the source's kennels"`.
  - `"a refresh failure is logged and doesn't fail the scrape"`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `scrapeSource`, call `refreshScheduleOnlyFlags({ sourceId, since: startedAt })`, then `refreshKennelEvidence(<kennel ids linked to the source via SourceKennel>)`. Wrap both in try/catch with `console.error`, the same non-blocking pattern the cron uses for `backfillLastEventDates`.
  - The nightly cron runs `refreshScheduleOnlyFlags("all")`, then `refreshKennelEvidence()`.
  - The admin backfill action also runs both, and returns the counts.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(kennel-status): refresh evidence after scrapes and nightly`.

### Task 5: Status rules (pure, client-safe)

**Files:**
- Create: `src/lib/kennel-status.ts`
- Test: `src/lib/kennel-status.test.ts`

**Interfaces:**
- Produces:
  - `type KennelState = "running" | "quiet" | "not-seen" | "stopped"`.
  - `interface KennelEvidence { lastRunSeenAt: Date | null; nextRunPostedAt: Date | null; lastConfirmedAt: Date | null; stoppedAt: Date | null }`.
  - `type SerializedKennelEvidence`: the same keys as ISO `string | null`, plus `toKennelEvidence(s: SerializedKennelEvidence): KennelEvidence` and `serializeKennelEvidence(e: KennelEvidence): SerializedKennelEvidence`.
  - `type StatusLine = { kind: "last-run" | "checked" | "next-posted" | "stopped"; date: Date } | { kind: "never" }`.
  - `getKennelState(e: KennelEvidence, now?: Date): KennelState`.
  - `getStatusLine(e: KennelEvidence, now?: Date): StatusLine | null`. Null when running. Otherwise, in order:
    - `stopped`;
    - `next-posted` if a real run is more than 60 days out;
    - `never` if there is no evidence;
    - `checked` if `lastConfirmedAt` is later than `lastRunSeenAt`;
    - else `last-run`.
  - `formatStatusLine(line: StatusLine, now?: Date): string`, the exact copy from Global Constraints, without the "check their page" suffix, which is a link the component adds.
  - `KENNEL_EVIDENCE_SELECT`, a Prisma `KennelSelect` of the four fields.
  - `runningKennelWhere(now?: Date): Prisma.KennelWhereInput`: `isHidden: false`, `stoppedAt: null`, and an OR over the three evidence fields per the running rule.
  - `listedKennelWhere(now?: Date): Prisma.KennelWhereInput`: running or quiet. This is the directory's "Active only" default.
  - Import only `type` from Prisma, as `activity-status.ts` does today, so client components can use the module.

- [ ] **Step 1: Write failing tests.**
  - Port the boundary cases from `src/lib/activity-status.test.ts` to `getKennelState`: evidence 89, 90, 91, 364, 365 and 366 days old, and null.
  - `"a real run posted 60 days out is running; 61 days out is not"` (Review Focus 1).
  - `"a far-off posted run with no other evidence shows next-posted"`.
  - `"stoppedAt makes the state stopped"`.
  - `"a confirmation newer than the last run shows checked"`.
  - `"a stale nextRunPostedAt in the past counts as evidence"`.
  - `"formatStatusLine uses MMM d this year and MMM yyyy otherwise"`, with the exact strings.
  - `"runningKennelWhere filters hidden and stopped kennels"`: snapshot of the where object for a fixed `now`.
  - `"serialize/toKennelEvidence round-trip"`.
- [ ] **Step 2:** Run `npx vitest run --config vitest.local.config.ts src/lib/kennel-status.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(kennel-status): status rules and status line`.

### Task 6: Admin confirmations, stop and restart

**Files:**
- Create: `src/app/admin/kennels/status-actions.ts`, `src/components/admin/KennelStatusDialog.tsx`
- Modify: `src/components/admin/KennelTable.tsx` (dropdown items near line 236, plus a status column), `src/app/admin/kennels/page.tsx` (select `KENNEL_EVIDENCE_SELECT`), `src/lib/event-filters.ts` (`DISPLAY_EVENT_WHERE`)
- Test: `src/app/admin/kennels/status-actions.test.ts`, `src/lib/event-filters.test.ts`

**Interfaces:**
- Consumes: `refreshKennelEvidence` (Task 3); `getStatusLine` / `formatStatusLine` (Task 5).
- Produces:
  - `confirmKennelRunning(kennelId: string, input: StatusInput): Promise<{ success: true } | { error: string }>`.
  - `stopKennel(kennelId: string, input: StatusInput): Promise<{ success: true; disabledSources: number; deactivatedRules: number } | { error: string }>`.
  - `restartKennel(kennelId: string): Promise<{ success: true; enabledSources: number; reactivatedRules: number } | { error: string }>`.
  - `interface StatusInput { observedOn: string /* YYYY-MM-DD */; note: string; url?: string }`.
  - `DISPLAY_EVENT_WHERE` gains `NOT: { isScheduleOnly: true, kennel: { stoppedAt: { not: null } } }`, so a stopped kennel's generated runs disappear from every display surface, reversibly.

- [ ] **Step 1: Write failing tests,** mocking `@/lib/db` and `getAdminUser` as `src/app/admin/kennels/actions.test.ts` does.
  - `"non-admins are rejected"`, for all three actions.
  - `"rejects a future observedOn, a note under 3 or over 500 characters, and a non-http(s) url"`.
  - `"confirmKennelRunning stores a RUNNING confirmation at UTC noon and refreshes that kennel"`.
  - `"stopKennel refuses when HashTracks saw a run after observedOn"`. The error names the date.
  - `"stopKennel disables only STATIC_SCHEDULE sources linked to this kennel alone, and deactivates its active rules, recording both id lists"` (Review Focus 5).
  - `"restartKennel re-enables exactly the recorded sources and rules and sets revertedAt"`.
  - `"restartKennel errors when there is no un-reverted stop"`.
  - In `event-filters.test.ts`: `"display filter hides schedule-only runs of stopped kennels"`, asserting on the where object.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Actions run their writes in one `$transaction`. Each then calls `refreshKennelEvidence([kennelId])`.
  - Log `[admin-audit]` like `toggleKennelVisibility`.
  - Revalidate the same paths and `HARELINE_EVENTS_TAG`.
  - Dialog fields: a date (default today), "How do you know?" (the note) and an optional link.
  - The table's status column shows `formatStatusLine(getStatusLine(...))`, or "Running".
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Run the dev server and check `/admin/kennels`. Add a confirmation to one kennel on the local DB, then stop and restart a STATIC_SCHEDULE kennel. Its generated runs leave and return on `/hareline`.
- [ ] **Step 6:** Commit: `feat(admin): dated kennel confirmations and reversible stop`.

### Task 7: Hand-review list script

**Files:**
- Create: `scripts/kennel-status-review.ts`

**Interfaces:**
- Consumes: the Task 1 columns, populated by Task 3/4.
- Produces: a read-only Markdown table on stdout. It lists every visible kennel that today's rule calls active (inlined: `lastEventDate` ≥ today−89 or an upcoming confirmed event) but that would not be running under `runningKennelWhere`. Columns:
  - kennel and region;
  - `lastEventDate`;
  - `lastRunSeenAt`;
  - source types;
  - website, Facebook URL;
  - the `/admin/kennels` link.

- [ ] **Step 1:** Implement. Follow `scripts/audit-travel-predictions.ts` for `createScriptPool` + `PrismaClient`. Never import `prisma/seed.ts`. Make no writes.
- [ ] **Step 2:** Run against the local DB with `npx tsx scripts/kennel-status-review.ts`. Expected: about 37 rows on the August snapshot. Spot-check that Upstate H3 is listed.
- [ ] **Step 3:** Commit: `chore(kennel-status): read-only hand-review list`.
- [ ] **Step 4:** Open PR A. Its description holds the Task 3 counts, and says it changes nothing public.

**Between PR A and PR B (owner):**
1. Merge PR A.
2. Let the nightly refresh run, or use the admin backfill button.
3. Run the review script against production with `BACKFILL_ALLOW_SELF_SIGNED_CERT=1`. This is a read.
4. In the week before PR B ships, record real, dated confirmations or stops for the listed kennels in `/admin/kennels`.

---

## PR B: public status (one release)

### Task 8: Cards, directory, counts, share image, sitemap

**Files:**
- Create: `src/components/kennels/KennelStatusLine.tsx`
- Modify:
  - `src/components/kennels/KennelCard.tsx` (badge → line; footer label);
  - `src/components/kennels/KennelDirectory.tsx` (the "Active only" filter near line 260);
  - `src/lib/kennel-directory.ts` (serialize evidence; `NextEvent.isScheduleOnly`; move `upcomingConfirmedEventWhere` here);
  - `src/app/kennels/page.tsx`;
  - `src/app/kennels/region/[slug]/page.tsx` (two counts, near lines 58 and 149);
  - `src/app/page.tsx` (homepage kennel count → `runningKennelWhere`);
  - `src/app/kennels/[slug]/opengraph-image.tsx`;
  - `src/app/sitemap.ts`.
- Delete: `src/components/kennels/ActivityStatusBadge.tsx`, `src/lib/activity-status.ts`, `src/lib/activity-status.test.ts`
- Test: `src/lib/kennel-directory.test.ts` (new), `src/lib/kennel-status.test.ts`

**Interfaces:**
- Consumes: everything from Task 5.
- Produces:
  - `KennelStatusLine` with props `{ evidence: SerializedKennelEvidence; website: string | null; facebookUrl: string | null }`. It renders nothing when running, and adds the ` · check their page ↗` link for `never`.
  - The directory's serialized kennel gains `evidence: SerializedKennelEvidence`.
  - `nextEvent` gains `isScheduleOnly: boolean`.
  - New analytics event `kennel_own_page_clicked { kennelSlug: string; surface: "card" | "kennel-page" }` in `src/lib/analytics.ts`. It is captured from every "check their page ↗" link (here and in Task 9), so the spec's measure of clicks out to a kennel's own page can be counted.

- [ ] **Step 1: Write failing tests.**
  - `"serializeKennelWithNext carries evidence and the next event's isScheduleOnly"`.
  - `"buildNextEventMap keeps isScheduleOnly"`.
  - `"directory card footer label is 'Usual schedule:' for a schedule-only next event"` (Review Focus 4). Put the label choice in an exported helper in `kennel-directory.ts` and test that.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The "Active only" filter becomes `state is running or quiet`.
  - The homepage and region counts use `runningKennelWhere`.
  - Share-image labels: `Running` / `Quiet lately` / `No recent runs seen` / `Stopped`.
  - Sitemap priority uses `nextRunPostedAt` / `lastRunSeenAt` in place of `lastEventDate`.
  - `grep -rn "activity-status\|ActivityStatusBadge" src` returns nothing.
- [ ] **Step 4:** Run the tests, then `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(kennels): status line from real evidence on cards and counts`.

### Task 9: Kennel page "How we know" and coverage

**Files:**
- Create: `src/lib/kennel-how-we-know.ts`, `src/components/kennels/HowWeKnow.tsx`
- Modify: `src/app/kennels/[slug]/page.tsx` (place it after `KennelStats`, near line 420), `src/components/kennels/KennelStats.tsx` ("Last Run" uses `lastRunSeenAt`); the "check their page" link sends Task 8's `kennel_own_page_clicked` with `surface: "kennel-page"`
- Test: `src/lib/kennel-how-we-know.test.ts`

**Interfaces:**
- Consumes: `KENNEL_EVIDENCE_SELECT`, `getStatusLine`, `formatStatusLine`, and `KennelStatusLine`.
- Produces: `getHowWeKnow(kennelId: string, now?: Date): Promise<HowWeKnow>`, where `HowWeKnow` is `{ coverage: KennelCoverage; items: EvidenceItem[] }`:
  - `KennelCoverage` is `{ level: "full"; sourceNames: string[] } | { level: "schedule" } | { level: "none" }`. **full** means at least one enabled non-STATIC_SCHEDULE source produced a real run for this kennel dated within the last 180 days or upcoming. **schedule** means a STATIC_SCHEDULE source or an active ScheduleRule exists. **none** means neither.
  - `EvidenceItem` is `{ kind: "last-run" | "next-posted" | "confirmed" | "stopped"; date: Date; detail: string | null; url: string | null }`. Show the newest three, with `detail` set to the source name or the confirmation note.

- [ ] **Step 1: Write failing tests.**
  - `"coverage is full when a non-schedule source produced a real run in the last 180 days"`.
  - `"coverage is schedule when only a STATIC_SCHEDULE source or rule exists"`.
  - `"coverage is none with no sources or rules"`.
  - `"a linked feed with no real run in 180 days does not count as full"`.
  - `"items are the newest three, newest first"`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** The coverage sentence uses the exact copy from Global Constraints. "Check their page ↗" links to the website, else Facebook, else nothing.
- [ ] **Step 4:** Run the tests. Then check a full, a schedule-only and a sourceless kennel's page on the dev server.
- [ ] **Step 5:** Commit: `feat(kennels): "How we know" and coverage on the kennel page`.

### Task 10: Travel stops calling generated runs confirmed

**Files:**
- Modify:
  - `src/lib/travel/search.ts`: Step 3's confirmed query near line 584; Step 8's evidence query near line 620; `fetchAllVisibleKennels`; the Possible row's `lastConfirmedAt` near line 825;
  - `src/lib/travel/projections.ts`: `KennelContext`, and `scoreConfidence` near line 332;
  - `src/pipeline/prediction-ledger.ts`;
  - `scripts/audit-travel-predictions.ts`.
- Test: `src/lib/travel/search.test.ts`, `src/lib/travel/projections.test.ts`

**Interfaces:**
- Consumes: `Event.isScheduleOnly`, and the Kennel evidence fields.
- Produces: `KennelContext.lastEvidenceAt: Date | null`, which replaces `lastEventDate` and holds the later of `lastRunSeenAt` and `lastConfirmedAt`. The audit script keeps its backtest semantics by passing its existing value under the new name.

- [ ] **Step 1: Write failing tests.**
  - `"a schedule-only run is not listed as confirmed, and its date is projected instead"`.
  - `"schedule-only runs don't count toward projection evidence"`.
  - `"the inactivity downgrade uses lastEvidenceAt"`.
  - `"a schedule-only kennel with a confirmation in the last 90 days keeps a HIGH rule as Likely"`.
  - `"a schedule-only kennel with no evidence in 90 days drops to Possible"`.
  - `"Possible row 'last posted' falls back to lastRunSeenAt, not lastEventDate"`.
- [ ] **Step 2:** Run `npx vitest run --config vitest.local.config.ts src/lib/travel`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Add `isScheduleOnly: false` to the confirmed and evidence queries.
  - Rename the context field and update every caller and fixture (`grep -rn "lastEventDate" src/lib/travel src/pipeline/prediction-ledger.ts scripts/audit-travel-predictions.ts`).
- [ ] **Step 4:** Run the Travel tests. Then check on the dev server: a city with a STATIC_SCHEDULE kennel shows its run under Likely or Possible, not Confirmed.
- [ ] **Step 5:** Commit: `feat(travel): generated runs move out of Confirmed`.

### Task 11: Hareline "Usual schedule" tag

**Files:**
- Modify: `src/app/hareline/actions.ts` (`HARELINE_EVENT_SELECT` near line 166 and the row mapper), `src/components/hareline/EventCard.tsx` (`HarelineEvent.isScheduleOnly?: boolean` and the chip), `src/components/hareline/EventDetailPanel.tsx` (one sentence)
- Test: `src/components/hareline/EventCard.test.ts`, `src/app/hareline/actions.test.ts` (the existing mapper test)

**Interfaces:**
- Consumes: `Event.isScheduleOnly`.
- Produces: `HarelineEvent.isScheduleOnly`. The card shows a `Usual schedule` chip with the title text `From the kennel's usual schedule, not a posted run`. The detail panel shows that sentence.

- [ ] **Step 1: Write failing tests.**
  - `"the hareline row mapper passes isScheduleOnly through"`.
  - The `EventCard.test.ts` helper that decides chips: `"schedule-only events get the Usual schedule chip"`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep the payload change to one boolean (the list cache is capped near 2 MB).
- [ ] **Step 4:** Run the tests, then the full suite: `npx tsc --noEmit && npm run lint && npx vitest run --config vitest.local.config.ts`. Expected: all pass. Delete `vitest.local.config.ts`.
- [ ] **Step 5:** Commit: `feat(hareline): tag runs generated from a usual schedule`, then open PR B.

**After PR B ships:**
1. Re-check a day later. Compare the counts by state with the Task 3 numbers.
2. Four weeks later, do the owner's requested review: with live data, does moving generated runs out of Confirmed still make sense? Use Travel search analytics and feedback reports.
