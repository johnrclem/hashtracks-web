# Kennel Status 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Travel search finds few runs, point to the other kennels near the place. List live kennels from Half-Mind that we lack, and record Half-Mind's dated checks of kennels we already have, credited to Half-Mind.

**Architecture:**
- **Travel bridge.** A pure selector (`src/lib/travel/other-kennels.ts`) picks quiet kennels inside a single-stop search radius that the results don't already show. It reuses Status 1's cached evidence and `KennelStatusLine`. Nothing new is stored.
- **Half-Mind listings.** A client for Half-Mind's public finder API (`/api/v1/kennels.php`) feeds `syncHalfMindDiscovery` into the existing `KennelDiscovery` queue (`externalSource: "HALFMIND"`).
  - An admin acts on every row:
    - **Link** records a `RUNNING` confirmation with `via: HALF_MIND`, shown with credit wherever it decides what a page says.
    - **Add** creates a listing-only kennel (`Kennel.listingOnly`).
    - **Unlink** undoes a link.
  - Re-running the sync refreshes the check dates of rows already linked or added.
  - A weekly cron that does the same ships switched off until the maintainer is happy.
  - The pilot covers one region (Georgia), set in code.

The work ships as two PRs:
- **PR A** (Tasks 1–2): the Travel bridge, which works with kennels we already have.
- **PR B** (Tasks 3–9): the Half-Mind import, listing-only kennels and the refresh.

PR B is unblocked: the owner answered the open question on 2026-11-17 (see "Owner answer").

**Tech Stack:** Next.js 16 App Router, Prisma 7 / Postgres, Vitest, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-10-kennel-status-design.md`, "Phase 2: listing kennels from Half-Mind" and "Owner answers" 3–4. Status 1 (sections 1–5) shipped in #2923, #2975 and #2976.

**What recon found (2026-11-17), and how it changes the spec's premise:**
- **The API accepts plain requests.** The spec assumed Half-Mind refuses automated clients (HTTP 406). That holds for its HTML listing pages (`/regionalwebsite/p_list1.php`). The finder at `https://half-mind.com/app/` loads `GET /api/v1/kennels.php`, and that answers plain requests with an honest User-Agent: 200, JSON.
- **Query parameters:** `country`, `state`, `lat`/`lng`/`radius` (miles), `day`, `q`, and `dead=1`.
  - **Dead kennels are left out unless `dead=1` is sent.** The finder's "Include dead kennels" box sends it (`app.js`).
- **Response:** `{ items, count, truncated }`.
- **Item fields, with their real JSON types:**

  | Field | Type and values |
  |---|---|
  | `id` | number |
  | `name`, `city`, `state`, `country`, `area` | string |
  | `lat`, `lng` | number |
  | `status` | string: `"active"`, `"unknown"` or `"dead"`. The finder shows "🔴 Dead" from this field. |
  | `current_state` | string: `"Alive and Verified"`, `"Unknown"`, `"UNKNOWN"` |
  | `last_verified` | `"2026-10-07 01:44:08"` or null |
  | `schedules` | a JSON array of strings, e.g. `["Monthly Tuesday 19:00 All Year", "Variable"]` |
  | `website`, `facebook`, `email`, `updated` | string |
  | `details` | always `/regionalwebsite/p_list1.php?ID=<id>` |
  | `verification_history_available` | boolean |

- **`robots.txt`** disallows only `/us/`.
- **Georgia:**
  - 25 listings without `dead=1`. 9 are "Alive and Verified", and 6 of those carry a `last_verified` date from Oct–Nov 2026.
  - Five of the six are kennels we have: pfh3, savh3, ph3-atl (Pine Lake H3 vs our "Pinelake H3"), sluth3 and sch3-atl. Two of those are on the Status 1 not-running list: Peach Fuzz H3 (Oct 7) and Southern Comfort H3 (Nov 9).
  - Only Southeast Xtra H3 would become listing-only.
  - Half-Mind holds some kennels more than once: Houston County H4, Middle Georgia H4 and Slackers on Trail H3 all point at `mgh4.com`.

## Owner answer (2026-11-17): yes

> "Half-Mind checks count as running evidence if they claim a kennel is active."

A Half-Mind check counts as running evidence only when the listing claims the kennel is active, meaning `externalStatus === "alive"` ("Alive and Verified"). The import bar already requires that at sync time and again when an admin acts, and the refresh records a newer check only when it passes the bar. A dated check on a listing that is "Unknown" or dead never becomes evidence. This plan is written for this answer, so PR B is unblocked.

The original question, kept for the record:

**Should a Half-Mind check count as full running evidence?**
- **Yes, with credit everywhere (recommended):** like an admin confirmation, it would set the kennel's state, lift its generated runs from Possible to Likely in Travel, and feed prediction confidence.
- **No:** it only shows as a credited line, and it never changes state or Travel.

A Half-Mind check is a volunteer confirming the listing, not a posted run. Half-Mind's own UI keeps "Last verified" apart from the listing's state, and a checker can answer "Don't know". This plan is written for **yes**.

**If the owner answers no, stop.** Revise Tasks 1, 3, 4 and 8 and get the plan re-reviewed before PR B starts. A "no" version needs a separate cached `lastListingCheckAt`, from which a listing-only kennel takes its state, directory visibility, bridge eligibility and credit line, while existing kennels ignore it. Without that, a listing-only kennel has no evidence at all: it reads as "not seen", the "Active only" filter hides it, the bridge skips it, and it shows "No runs seen on HashTracks" with no credit.

## Global Constraints

- **Honest client:**
  - User-Agent `HashTracks/1.0 (+https://www.hashtracks.xyz)`.
  - No browser rendering, stealth plugin or residential/VPN proxy for Half-Mind.
  - One request per scope, always with `dead=1`, run one after another.
  - On a network error, HTTP 403, 406, 429 or any other non-200, or a body that isn't JSON: record one error for that scope and write nothing for it. Never retry in disguise.
- **Never store or log Half-Mind's `email` field.** No mapped type has it, and error messages carry counts and row indexes only.
- **Status, normalised into `KennelDiscovery.externalStatus`:**
  - `"dead"` when `status` is "dead" (case-insensitive), or `current_state` contains "dead";
  - `"alive"` when `current_state` is "alive and verified", case-insensitive, after trimming;
  - `"unknown"` otherwise;
  - `"missing"` when the sync sets it: a linked or added listing absent from a complete (`truncated: false`) scope response.
- **Import bar (a check counts):** all four must hold:
  - `externalStatus` is `"alive"`;
  - `last_verified` parses to a date that is not in the future and is within the last 365 days, today counting as day 1;
  - a `website` or `facebook` URL passes `safeUrl`;
  - `lat` and `lng` are finite numbers.

  The bar is checked at sync time and again when an admin acts.
- **Nothing published from an automatic match.** A Half-Mind row stays `NEW` until an admin acts. The sync never sets `MATCHED`, never creates a `SourceKennel` and never creates an alias. Half-Mind actions never create an alias from the numeric id.
- **One listing per kennel.** `Kennel.halfMindListingId` is unique. A second listing for a kennel that is already linked is refused with a clear error; the admin dismisses the duplicate.
- **Credit copy, exact strings:**
  - status line: `Half-Mind listing checked · {d}`;
  - confirmation note: `Half-Mind listing checked {Mon D, YYYY}`;
  - HowWeKnow label: `Half-Mind listing checked`;
  - coverage sentence: `We only know their Half-Mind listing`.
  - The listing URL is `https://half-mind.com/regionalwebsite/p_list1.php?ID={id}`. Never write "Checked running" or "Confirmed running" for a Half-Mind check.
- **When the credit line shows:**
  - When the state is not running, the existing rule picks the line, and a Half-Mind `checked` line reads `Half-Mind listing checked · {d}`.
  - When the state is running, the Half-Mind line shows only when the check decides it. That means `lastConfirmedVia` is `HALF_MIND`, and the kennel would not be running without the check: `getKennelState` with `lastConfirmedAt: null` is not `"running"`.
  - A running kennel with its own recent runs (Savannah H3: run Oct 1, check Oct 2) shows no line, as in Status 1.
- **Listing-only kennels always show a status line:** the deciding check's line, or `Checked running · {d}` when an admin confirmation is newest. They always show the link out to the kennel's own page.
- **Listing-only kennel:**
  - no `ScheduleRule` rows, so never in Travel predictions or the Hareline;
  - kennel page `robots: { index: false, follow: true }`;
  - left out of `sitemap.ts`.
  - The nightly refresh clears `listingOnly` only once the kennel has real evidence (`lastRunSeenAt` or `nextRunPostedAt` non-null). A `STATIC_SCHEDULE` source alone never clears it.
- **Travel bridge:**
  - heading `Other kennels near {place}`;
  - shown for single-stop searches only (the `wantNearestConfirmed` gate);
  - only when the stop's shown rows (`filtered.confirmed` + `filtered.likely`) number fewer than 3, and the primary radius has at least one kennel;
  - candidates are in-radius kennels that are quiet, or listing-only and running;
  - at most 5, closest first;
  - never mixed into Confirmed / Likely / Possible;
  - each row links to the kennel's own page.
  - The user's confidence and distance-tier filters don't apply: it is not a result list.
- **Pilot scope:** `[{ country: "USA", state: "GA" }]`. More regions are a one-line change after the owner reviews the pilot.
- **Repo rules:**
  - Dates are stored at UTC noon. Schema changes go through `npm run prisma -- migrate dev`.
  - Tests sit next to source. In a worktree, run vitest with a temporary config that drops the `.claude/worktrees` exclude, and delete it before committing.
  - SonarCloud and Codacy gates apply: no `new RegExp(variable)`, regex complexity ≤ 20, and duplication ≤ 3% (extract shared code, don't copy it).

## Review Focus

1. **The Half-Mind API breaks.** The call may throw (timeout or DNS), or answer with a 429, a 406, HTML with a 200, `{ "error": … }` or `items` that isn't an array. Each case is one error for that scope, no writes and no throw. *(Task 5, Task 6)*
2. **`last_verified` is unusable.** It may be null, `"0000-00-00 00:00:00"`, unparseable or in the future. The listing then fails the bar, link and add record no confirmation, and the refresh records nothing. *(Task 5, Task 6)*
3. **Linking goes wrong.**
   - The listing is already on another kennel, or the kennel already has a different listing: refused, nothing written. A concurrent link that hits P2002 gets the same message.
   - A wrong link is undone by Unlink: the kennel's Half-Mind checks are reverted, and the refresh doesn't record them again.

   *(Task 6)*
4. **The bridge shows nothing new.** It is absent when every in-radius kennel is running, or already appears in the shown rows. A quiet kennel shown under Possible is not shown again. A not-seen listing-only kennel is not shown. *(Task 1)*
5. **A listing-only kennel gets a source.**
   - A `STATIC_SCHEDULE` source alone keeps it listing-only.
   - A real run makes it indexable and puts it in the sitemap after the next refresh.

   *(Task 3)*

---

## PR A — Travel bridge

### Task 1: Pick the other kennels for a stop

**Files:**
- Create: `src/lib/travel/other-kennels.ts`, `src/lib/travel/other-kennels.test.ts`
- Modify: `src/lib/travel/search.ts` (the `fetchAllVisibleKennels` select, `NearbyKennel`, `DestinationResult`, `runStopSearch`)
- Modify: `src/lib/travel/serialize.ts` (+ its test)

**Interfaces:**
- Consumes:
  - `getKennelState`, `KennelEvidence`, `KENNEL_EVIDENCE_SELECT` from `@/lib/kennel-status`;
  - `kennelOwnPageUrl` from `@/lib/safe-url`;
  - `regionNameToSlug` from `@/lib/region`, which returns `string | null`.
- Produces:
  - `export const OTHER_KENNELS_LIMIT = 5`
  - `export const FEW_RUNS_THRESHOLD = 3`
  - `export type OtherKennelCandidate = KennelEvidence & { id: string; slug: string; shortName: string; fullName: string; region: string; website: string | null; facebookUrl: string | null; distanceKm: number; listingOnly: boolean }`
  - `export interface OtherKennel { kennelId: string; slug: string; shortName: string; fullName: string; region: string; distanceKm: number; evidence: KennelEvidence; ownPageUrl: string | null; listingOnly: boolean }`
  - `export function shouldShowOtherKennels(confirmedCount: number, likelyCount: number): boolean`
  - `export function selectOtherKennels(nearby: OtherKennelCandidate[], shownKennelIds: ReadonlySet<string>, now: Date, limit?: number): OtherKennel[]`
  - `export function otherKennelsHeading(place: string): string`
  - `export function otherKennelsBrowseLink(kennels: Pick<OtherKennel, "region">[]): { label: string; href: string } | null`
  - `DestinationResult.otherKennels?: OtherKennel[]`
  - `SerializedTravelResults.otherKennels?: SerializedOtherKennel[]` (evidence serialized with `serializeKennelEvidence`).

- [ ] **Step 1: Write the failing tests** in `other-kennels.test.ts`. Use a fixed `now` = `2026-11-17T12:00:00Z`.
  - `shouldShowOtherKennels`: `(0,0)` → true, `(1,1)` → true, `(2,1)` → false, `(0,3)` → false.
  - `selectOtherKennels`:
    - **"keeps quiet kennels, closest first":** given quiet kennels (`lastRunSeenAt` 2026-06-02) at 12, 3 and 7 km, it returns the order 3, 7, 12.
    - **"drops running, not-seen and stopped kennels":** for example `lastRunSeenAt` 10 days ago; no evidence; `stoppedAt` set.
    - **"drops kennels already shown":** a quiet kennel whose id is in `shownKennelIds` is absent.
    - **"caps at the limit":** 7 quiet kennels → 5.
    - **"keeps running listing-only kennels, drops not-seen ones":** `listingOnly: true` with `lastConfirmedAt` 20 days ago is kept; `listingOnly: true` with `lastConfirmedAt` 2025-01-10 is dropped.
    - **"sets ownPageUrl from website, then Facebook":** follows `kennelOwnPageUrl`.
  - `otherKennelsHeading("Savannah")` returns `Other kennels near Savannah`.
  - `otherKennelsBrowseLink`:
    - `[{ region: "Savannah, GA" }, { region: "Atlanta, GA" }]` returns `{ label: "Browse kennels in Savannah, GA", href: "/kennels/region/" + regionNameToSlug("Savannah, GA") }` (the first, closest kennel's region);
    - `[{ region: "Nowhere" }]`, where `regionNameToSlug` returns null, returns `{ label: "Browse the kennel directory", href: "/kennels" }`;
    - `[]` returns null.

- [ ] **Step 2: Run** `npx vitest run src/lib/travel/other-kennels.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `other-kennels.ts`.**
  - A candidate qualifies when it is not in `shownKennelIds`, and its state is `quiet`, or it is `listingOnly` and its state is `running`.
  - Sort by `distanceKm` ascending, ties by `shortName`. Slice to `limit`.

- [ ] **Step 4: Wire it into `search.ts`.**
  - Replace the explicit `lastRunSeenAt`/`lastConfirmedAt` keys in the `fetchAllVisibleKennels` select with a spread of `KENNEL_EVIDENCE_SELECT`. Keeping both trips TS2783. Add the two new evidence fields to `NearbyKennel`.
  - In `runStopSearch`, after the broader-pass adoption and the empty-state block, do the following when `ctx.wantNearestConfirmed && primary.length > 0 && shouldShowOtherKennels(filtered.confirmed.length, filtered.likely.length)`:
    - map `primary` (the in-radius `NearbyKennel[]`) to `OtherKennelCandidate`, with `listingOnly: false` until Task 8 adds the column;
    - build `shownKennelIds` from `filtered.confirmed`, `filtered.likely` and `filtered.possible` (`kennelId`). These hold whichever pass was adopted, so the broader rows are covered too;
    - set `destination.otherKennels = selectOtherKennels(candidates, shownKennelIds, ctx.now)`, and leave it unset when it is empty.
  - Hoist `destinations[0].otherKennels` to `serializedResults.otherKennels`, the same way `nearestConfirmed` is hoisted.
  - Add `search.test.ts` cases:
    - a single-stop search with one quiet in-radius kennel and no runs returns it in `destinations[0].otherKennels`;
    - a two-stop search returns none;
    - a quiet kennel that already has a Possible row is not repeated.

- [ ] **Step 5: Run** `npx vitest run src/lib/travel` and `npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 6: Commit** `feat(travel): pick quiet kennels near a thin search (Status 2, bridge data)`.

### Task 2: Show "Other kennels near {place}"

**Files:**
- Create: `src/components/travel/OtherKennelsSection.tsx`. It has no render test: the repo has no React test setup (see `PossibleRow.test.ts`), so its copy and links come from Task 1's tested helpers, and the browser check covers the rest.
- Modify: `src/app/travel/page.tsx` (both the search and saved-trip render paths)
- Modify: `src/components/kennels/KennelStatusLine.tsx` (+ a test of its new pure helper)
- Modify: `src/components/kennels/OwnPageLink.tsx` and `src/lib/analytics.ts` (the `surface` union gains `"travel"`)

**Interfaces:**
- Consumes: `SerializedOtherKennel`, `otherKennelsHeading`, `otherKennelsBrowseLink` (Task 1).
- Produces:
  - `export function ownPageFor(line: StatusLine, ownPageUrl: string | null, showOwnPage: boolean): string | null`, exported from `KennelStatusLine.tsx`. It returns `ownPageUrl` when `line.kind === "never"` or `showOwnPage` is true, and null otherwise.
  - `KennelStatusLine` gains `showOwnPage?: boolean` (default false).
  - `export function OtherKennelsSection(props: Readonly<{ place: string; kennels: SerializedOtherKennel[] }>)`, which returns null for an empty list.

- [ ] **Step 1: Write the failing test** `KennelStatusLine.test.ts` for `ownPageFor`:
  - a `never` line → url;
  - a `last-run` line with `showOwnPage` false → null, and with `showOwnPage` true → url;
  - a null `ownPageUrl` → null.

  Run it. Expected: FAIL.

- [ ] **Step 2: Implement `ownPageFor`** and use it in place of the `line.kind === "never"` expression (`KennelStatusLine.tsx:36`). Add `"travel"` to the `surface` unions in `KennelStatusLine`, `OwnPageLink` and `analytics.ts`. Run the test and `npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 3: Implement the section.**
  - Match `NearestConfirmedSection`: a `TravelHintBadge` with glyph `○` and label `Kennels in your area`, then a heading row with `otherKennelsHeading(place)`.
  - Then one compact row per kennel: the `shortName` linked to `/kennels/{slug}`, the full name, the distance rounded to whole km (`3 km`), and `<KennelStatusLine evidence ownPageUrl kennelSlug surface="travel" showOwnPage />`.
  - Add a footer link from `otherKennelsBrowseLink(kennels)`.

- [ ] **Step 4: Place it in `page.tsx`** after `TravelResults`, in both the empty-state and non-empty branches of the search path and in the saved-trip path: `{serializedResults.otherKennels && <OtherKennelsSection place={...} kennels={serializedResults.otherKennels} />}`. `place` is the same `extractCityName(...)` value `EmptyStates` receives.

- [ ] **Step 5: Verify in the browser** (preview tools, local DB copy). Find a destination with a quiet kennel inside the radius: query the local DB for visible kennels whose `lastRunSeenAt` is 90–365 days old and that have coordinates, and search near one.
  - The section appears below the results with at most 5 rows.
  - Each row's `Last run we saw · …` line ends in `check their page ↗` when the kennel has a website or Facebook link, and that link opens the kennel's own site.
  - A destination whose kennels are all running shows no section.
  - Take a screenshot for the PR.

- [ ] **Step 6: Run** `npx tsc --noEmit && npm run lint && npm test`, then commit `feat(travel): "Other kennels near" section for thin searches`.

- [ ] **Step 7: Open PR A.**

---

## PR B — Half-Mind listings

PR B's Vercel preview will fail to build with P2022: `/kennels` prerenders and selects the new columns, and previews skip `migrate deploy`. Prove the production build with a local `next build` against the migrated local DB, and say so in the PR body.

### Task 3: Schema, cached "via", and the credit rule

**Files:**
- Modify: `prisma/schema.prisma`; a new migration `kennel_status_2_half_mind`
- Modify: `src/pipeline/kennel-evidence.ts` (+ test)
- Modify: `src/lib/kennel-status.ts` (+ test)
- Modify: every `KennelEvidence` builder or fixture that tsc flags

**Interfaces:**
- Produces:
  - `enum ConfirmationVia { ADMIN HALF_MIND }`
  - `KennelConfirmation.via ConfirmationVia @default(ADMIN)`
  - `Kennel.lastConfirmedVia ConfirmationVia?`
  - `Kennel.listingOnly Boolean @default(false)`
  - `Kennel.halfMindListingId String? @unique`
  - `KennelDiscovery.externalStatus String?`, `externalCheckedAt DateTime?`, `externalScope String?` (e.g. `"USA/GA"`), `facebookUrl String?`
  - `KennelEvidence.lastConfirmedVia: "ADMIN" | "HALF_MIND" | null`, added to `KENNEL_EVIDENCE_SELECT` and the serialize/parse pair.
  - The `StatusLine` `"checked"` variant gains `via: "ADMIN" | "HALF_MIND"`.
  - `export function isHalfMindDeciding(e: KennelEvidence, now?: Date): boolean`
  - `getStatusLine(e: KennelEvidence, now?: Date, opts?: { listingOnly?: boolean }): StatusLine | null`

- [ ] **Step 1: Write the failing tests.**
  - `kennel-status.test.ts`:
    - `formatStatusLine({ kind: "checked", via: "HALF_MIND", date })` returns `Half-Mind listing checked · Oct 7`. With `via: "ADMIN"` it still returns `Checked running · Oct 7`.
    - `getStatusLine` returns `{ kind: "checked", via: "HALF_MIND", date }`, not null, for a running kennel when `isHalfMindDeciding`:
      - `lastConfirmedVia: "HALF_MIND"`, `lastConfirmedAt` 20 days ago, `lastRunSeenAt` 200 days ago, no posted run.
    - It still returns null for a running kennel when:
      - **the Savannah case:** `lastRunSeenAt` 47 days ago and a HALF_MIND check 46 days ago;
      - or a posted run sits within 60 days;
      - or the check is an ADMIN one.
    - With `{ listingOnly: true }`:
      - a running kennel whose newest confirmation is ADMIN returns `{ kind: "checked", via: "ADMIN", date }`;
      - one with no confirmation returns `{ kind: "never" }`.
  - `kennel-evidence.test.ts`:
    - the SQL selects the newest RUNNING confirmation's `via` into `"lastConfirmedVia"`, and compares it with `IS DISTINCT FROM`;
    - `"listingOnly"` is set from `k."listingOnly" AND c."lastRunSeenAt" IS NULL AND c."nextRunPostedAt" IS NULL`, and the change guard compares it. The SQL never mentions `"SourceKennel"` for this.

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Edit the schema and create the migration** with `npm run prisma -- migrate dev --name kennel_status_2_half_mind` against the local DB. Review the SQL: additive columns, one enum, one unique index, no data changes.

- [ ] **Step 4: Implement.**
  - In `refreshKennelEvidence`, the `confirmations` CTE adds `(array_agg(c.via ORDER BY c."observedAt" DESC, c."createdAt" DESC) FILTER (WHERE c.kind = 'RUNNING'))[1] AS "lastConfirmedVia"`. The `computed` CTE carries it, and the `UPDATE` writes it and compares it.
  - The `listingOnly` expression is the one in the test, written and compared the same way.
  - In `kennel-status.ts`, `isHalfMindDeciding` holds when all of these hold:
    - not stopped;
    - `lastConfirmedVia === "HALF_MIND"`;
    - the state is `"running"`;
    - `getKennelState({ ...e, lastConfirmedAt: null }, now)` is not `"running"`.
  - `getStatusLine`, before its `running → null` check:
    - returns the HALF_MIND `checked` line when `isHalfMindDeciding`;
    - with `opts.listingOnly` and a `lastConfirmedAt`, returns the `checked` line with `via: e.lastConfirmedVia ?? "ADMIN"`.

    Elsewhere it attaches `via: e.lastConfirmedVia ?? "ADMIN"` to `checked`.
  - `formatStatusLine` picks the copy by `via`.
  - The admin `KennelTable` keeps its rule of showing the line when there is one (`KennelTable.tsx:175`, `235`). A Half-Mind-decided kennel there reads `Half-Mind listing checked · …` instead of "Running", which tells the admin what is keeping it running.

- [ ] **Step 5: Run** `npx tsc --noEmit` and fix every flagged `KennelEvidence` literal by adding `lastConfirmedVia: null`. Leave `src/lib/travel/format.ts:329` for Task 4; give it an explicit `via: "ADMIN"` only as a temporary placeholder. Run `npx vitest run src/lib src/pipeline`. Expected: PASS.

- [ ] **Step 6: Dry-run the migration against prod** inside `BEGIN; … ROLLBACK;`, following `.claude/rules/prod-data-ops.md`. Report the per-statement counts in the PR. Commit `feat(kennel-status): ConfirmationVia, listing-only flag, Half-Mind discovery fields`.

### Task 4: Credit the Half-Mind check on every surface

**Files:**
- Modify: `src/lib/travel/search.ts`:
  - `recentConfirmation` (around line 1144) and the `checkedRunningAt` assignment (around line 848) carry `via`;
  - the `fetchAllVisibleKennels` select adds `halfMindListingId`;
  - `OtherKennelCandidate` and `OtherKennel` (Task 1) gain `halfMindListingId: string | null`.
- Modify: `src/lib/travel/serialize.ts` (around lines 39–42 and 81) and `src/components/travel/LikelyCard.tsx` (around line 29): the `checkedRunningAt` shape.
- Modify: `src/lib/travel/format.ts`: `likelyEvidenceCaption` (around line 329).
- Modify: the card data plumbing, for `halfMindListingId`:
  - `KennelCardData` in `src/components/kennels/KennelCard.tsx` (around line 10);
  - `serializeKennelWithNext` in `src/lib/kennel-directory.ts`;
  - the selects in `src/app/kennels/page.tsx` (around lines 44–63) and `src/app/kennels/region/[slug]/page.tsx` (around lines 85–103). The kennel page's query uses `include`, so it needs no select change.
- Modify: `src/components/kennels/HowWeKnow.tsx` (around line 33), `src/lib/kennel-how-we-know.ts` (+ test)
- Modify: `src/lib/kennel-confirmations.ts`: the `evidenceAfter` stop-refusal copy (around line 100) (+ test)
- Modify: `src/components/kennels/KennelStatusLine.tsx` (+ test): `ownPageFor` also returns the url for a HALF_MIND `checked` line, and a new `listingUrl` prop.
- Create: `src/lib/half-mind.ts`, client-safe: `export function halfMindListingUrl(listingId: string): string`.

**Interfaces:**
- Consumes: Task 3's `via` and `isHalfMindDeciding`.
- Produces:
  - `checkedRunningAt` becomes `{ date: Date; via: "ADMIN" | "HALF_MIND" } | null`, with its serialized form to match;
  - `HowWeKnow` `confirmed` items carry `via`;
  - `KennelStatusLine` gains `listingUrl?: string | null`.

- [ ] **Step 1: Write the failing tests.**
  - `likelyEvidenceCaption` with a HALF_MIND `checkedRunningAt` returns `Half-Mind listing checked · Nov 9`; with an ADMIN one, `Checked running · Nov 9`.
  - `getHowWeKnow` maps a HALF_MIND confirmation to `{ kind: "confirmed", via: "HALF_MIND", url: <listing url> }`, and HowWeKnow renders the label `Half-Mind listing checked`. This is a pure label helper, `confirmedLabel(via)`, tested directly.
  - The stop-refusal copy names a Half-Mind check as `the Half-Mind listing was checked on …`.
  - `halfMindListingUrl("19")` returns `https://half-mind.com/regionalwebsite/p_list1.php?ID=19`, and the id is URL-encoded.
  - `ownPageFor` returns the url for `{ kind: "checked", via: "HALF_MIND" }` even without `showOwnPage`.

- [ ] **Step 2: Implement.**
  - When the line is a HALF_MIND `checked` line and `listingUrl` is set, `KennelStatusLine` renders the words `Half-Mind listing` as a link to it. The link is above the card's stretched link (`aboveCardLink`) and opens in a new tab with `rel="noopener noreferrer"`.
  - Pass `listingUrl={id ? halfMindListingUrl(id) : null}` from the card, the kennel page and the bridge row, using the `halfMindListingId` this task adds to their data.
  - This task is written for the owner's "yes". For "no", see the open question: stop and re-plan.

- [ ] **Step 3: Run** `npx tsc --noEmit` and `npx vitest run src/lib src/components`. Expected: PASS. Commit `feat(kennel-status): credit Half-Mind checks in status lines, Travel and How we know`.

### Task 5: Half-Mind client

**Files:**
- Create: `src/adapters/half-mind/client.ts`, `src/adapters/half-mind/client.test.ts`
- Create: `src/adapters/half-mind/fixtures.ts`, built from the 2026-11-17 Georgia response with every `email` removed, real types kept.

**Interfaces:**
- Consumes: `safeFetch` from `src/adapters/safe-fetch.ts`; `safeUrl` from `@/lib/safe-url`.
- Produces:
  - `export const HALF_MIND_API_URL = "https://half-mind.com/api/v1/kennels.php"`
  - `export const HALF_MIND_USER_AGENT = "HashTracks/1.0 (+https://www.hashtracks.xyz)"`
  - `export type HalfMindStatus = "alive" | "unknown" | "dead" | "missing"`
  - `export interface HalfMindScope { country: string; state?: string }`
  - `export function scopeKey(s: HalfMindScope): string` (`"USA/GA"`)
  - `export interface HalfMindListing { id: string; name: string; city: string | null; state: string | null; country: string; latitude: number | null; longitude: number | null; status: Exclude<HalfMindStatus, "missing">; lastVerifiedAt: Date | null; schedule: string | null; website: string | null; facebookUrl: string | null }`
  - `export function parseHalfMindResponse(body: unknown, now: Date): { listings: HalfMindListing[]; truncated: boolean; errors: string[] }`
  - `export function cleanHalfMindSchedule(raw: unknown): string | null`
  - `export function passesImportBar(l: Pick<HalfMindListing, "status" | "lastVerifiedAt" | "website" | "facebookUrl" | "latitude" | "longitude">, now: Date): boolean`
  - `export async function fetchHalfMindListings(scope: HalfMindScope, now?: Date): Promise<{ listings: HalfMindListing[]; truncated: boolean; errors: string[] }>`

- [ ] **Step 1: Write the failing tests.**
  - `parseHalfMindResponse(fixture, now)`:
    - returns 25 listings;
    - `Peach Fuzz H3` has `id === "19"`, `status === "alive"` and `lastVerifiedAt` = `2026-10-07T12:00:00Z` (the date part at UTC noon). Its `latitude`/`longitude` are numbers and its `schedule` is `"Bi-weekly Saturday 2 PM"`.
    - no listing object has an `email` key;
    - numeric-string `id`/`lat`/`lng` are accepted too.
  - Status mapping:
    - `{ status: "dead" }` → `"dead"`;
    - `{ status: "active", current_state: "Alive and Verified" }` → `"alive"`;
    - `{ current_state: "UNKNOWN" }` → `"unknown"`.
  - Each of these returns `errors.length === 1` and no listings: `"<html>"`, `{ error: "x" }`, `{ items: "nope" }`. A row missing `id` or `name` is skipped with one error naming the row index, not its contents.
  - `lastVerifiedAt` is null for `null`, `"0000-00-00 00:00:00"`, `"garbage"` and a date after `now`.
  - `cleanHalfMindSchedule`. It removes `All Year`, maps a trailing `DST` to `(summer)` and `ST` to `(winter)`, drops `Variable`, writes times in 12-hour form and joins entries with ` · `. Use string operations and one simple `HH:MM` regex, nothing with nested quantifiers (Sonar S5852).

    | Input | Output |
    |---|---|
    | `["Bi-weekly Saturday 14:00 All Year"]` | `"Bi-weekly Saturday 2 PM"` |
    | `["Monthly Tuesday 19:00 All Year", "Variable"]` | `"Monthly Tuesday 7 PM"` |
    | `["Every Year 13:00 ST", "18:30 Summer"]` | `"Every Year 1 PM (winter) · 6:30 PM Summer"` |
    | `["1st Tuesday 19:00 DST"]` | `"1st Tuesday 7 PM (summer)"` |
    | `["Every Saturday 11:00 All Year"]` | `"Every Saturday 11 AM"` |
    | `["Variable"]`, `[]`, `null` | `null` |
    | the string `"['Every Month 19:00 All Year']"` (a defensive fallback) | `"Every Month 7 PM"` |

  - `passesImportBar`, with `now` = 2026-11-17:
    - true for Peach Fuzz;
    - false for Black Sheep H3 (alive, no date), for "unknown" listings, for a `2025-10-01` check (more than 365 days old), for a listing with no website or Facebook, and for one with null coordinates.
  - `fetchHalfMindListings` (mock `safeFetch`):
    - sends the User-Agent and `Accept: application/json` with `country`, `state` and `dead=1`;
    - a 406 returns `errors` = `["Half-Mind API returned HTTP 406"]` and makes no second request; the same holds for 429 and 403;
    - a thrown `safeFetch` (timeout) returns `["Half-Mind API request failed"]`;
    - a 200 with an HTML body returns one error.
    - None of these throw.

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Implement.** Validate at runtime: `items` must be an array of objects. Map only the allowed fields. Error messages carry counts and row indexes, never row contents.

- [ ] **Step 4: Verify live** (`.claude/rules/live-verification.md`) with a throwaway script, not committed, that calls `fetchHalfMindListings({ country: "USA", state: "GA" })`. With `dead=1` the count may now exceed 25.
  - Report: the total count; how many are dead; how many pass the bar (expected about 6); and one passing sample with all fields.
  - If the live shape differs from the fixture, update the fixture.

- [ ] **Step 5: Commit** `feat(half-mind): honest client for Half-Mind's finder API`.

### Task 6: Sync into the discovery queue, plus the review actions

**Files:**
- Modify: `src/pipeline/kennel-discovery.ts`. Extract two helpers, with no change in Hash Rego behavior; the existing `kennel-discovery.test.ts` must pass unchanged:
  - `export async function loadDiscoveryCandidates(): Promise<{ candidates: FuzzyCandidate[]; geoMap: Map<string, KennelGeoData> }>`, the kennel + alias load now inline in `syncKennelDiscovery` (around lines 254–295);
  - `export function rankDiscoveryCandidates(names: string[], geo: DiscoveryGeoContext, candidates: FuzzyCandidate[], geoMap: Map<string, KennelGeoData>): { id: string; shortName: string; score: number }[]`. It returns the top 3 by geo-adjusted score at **every** score, best first. `computeMatchResult` keeps its MATCHED/NEW thresholds on top of it.
- Create: `src/lib/kennel-revalidate.ts`. Move `revalidateKennel` out of `src/app/admin/kennels/status-actions.ts` into it, as a plain module, and import it back there.
- Modify: `src/lib/kennel-confirmations.ts`. `confirmKennelRunningFor` gains a trailing `opts?: { via?: "ADMIN" | "HALF_MIND"; onlyIfNewerForUrl?: string }`.
  - **`onlyIfNewerForUrl`** holds a listing URL. The write is skipped when any HALF_MIND confirmation for the kennel with that `url`, reverted or not, has `observedAt` ≥ the new one. The comparison is per listing, so a wrong link that is undone never blocks the right listing. It runs inside the transaction after `lockKennel`, and a skip returns `{ skipped: true }`.
  - **With `via: "HALF_MIND"`, a stopped kennel returns `{ stopped: true }`** instead of the error text. ADMIN callers keep today's error.
  - Add `export async function revertHalfMindChecksFor(kennelId: string, now?: Date): Promise<number>`, which sets `revertedAt` on the kennel's un-reverted HALF_MIND RUNNING confirmations and calls `refreshAfterWrite`.
- Modify: `src/app/admin/shared/kennel-creation.ts`. `createKennelFromDiscovery` accepts these optional fields, written only when given: `listingOnly`, `halfMindListingId`, `facebookUrl`, `scheduleNotes`, `latitude`, `longitude`.
- Modify: `src/app/admin/discovery/actions.ts`. `linkDiscoveryToKennel`, `addKennelFromDiscovery`, `confirmMatch` and `getDiscoveryPrefill` return `{ error: "Use the Half-Mind actions for Half-Mind rows." }` when `externalSource === "HALFMIND"`. `dismissDiscovery` and `bulkDismissDiscoveries` refuse, or skip, a HALFMIND row unless its status is NEW.
  - The guard is narrow on purpose. These actions already misbehave on AI-discovery (GEMINI) rows: a global alias plus a Hash Rego `SourceKennel` with a non-Hash Rego slug. That predates this plan and is filed as a separate follow-up, out of scope here.
- Create: `src/pipeline/half-mind-discovery.ts` (+ test), `src/app/admin/discovery/half-mind-actions.ts` (+ test)

**Interfaces:**
- Produces:
  - `export const HALF_MIND_EXTERNAL_SOURCE = "HALFMIND"`
  - `export const HALF_MIND_SYNC_SCOPES: HalfMindScope[] = [{ country: "USA", state: "GA" }]`
  - `export function halfMindCheckNote(checkedAt: Date): string`, which returns `Half-Mind listing checked Oct 7, 2026`
  - `export interface HalfMindSyncResult { scopes: number; fetched: number; passedBar: number; created: number; updated: number; refreshedChecks: number; skippedStopped: number; flaggedDeadOrMissing: number; errors: string[] }`
  - `export async function syncHalfMindDiscovery(scopes?: HalfMindScope[], now?: Date): Promise<HalfMindSyncResult>`
  - Server actions (admin only; each refuses a row whose `externalSource` is not `"HALFMIND"`):
    - `runHalfMindSync()`
    - `linkHalfMindListing(discoveryId: string, kennelId: string)`: `{ success: true; warning?: string } | { error: string }`
    - `unlinkHalfMindListing(discoveryId: string)`
    - `addListingOnlyKennel(discoveryId: string, data: { shortName: string; fullName: string; regionId: string }, opts?: { confirmNotDuplicate?: boolean })`: `{ success: true; kennelId: string } | { error: string; duplicateOf?: { id: string; shortName: string; score: number } }`
    - `dismissHalfMindListing(discoveryId: string)` (NEW rows only)

- [ ] **Step 1: Write the failing tests.** Mock prisma, the client and `confirmKennelRunningFor`.
  - `half-mind-discovery.test.ts`:
    - **Bar filter:** a listing that passes the bar and isn't stored is created with:
      - `status: "NEW"`, `externalSource: "HALFMIND"`, `externalSlug` = the id, `externalScope: "USA/GA"`;
      - `name`, `location` = `"{city}, {state}, {country}"`, `latitude`, `longitude`, `schedule`, `website`, `facebookUrl`;
      - `externalUrl` = `halfMindListingUrl(id)`, `externalStatus`, `externalCheckedAt`;
      - `matchCandidates` = the ranked top 3, and `matchScore` = the best score.

      A listing that fails the bar and isn't stored writes nothing.
    - **1.0 match:** an exact-name listing stores that kennel as candidate #1 with score 1. The row stays NEW, and no `SourceKennel` or alias is written.
    - **Existing rows:** an existing row of any status gets its fields updated and keeps its status.
    - **Refresh, newer check:** for a LINKED or ADDED row whose kennel has `halfMindListingId` = the id, a `lastVerifiedAt` that passes the bar calls `confirmKennelRunningFor` once. The call carries:
      - `via: "HALF_MIND"` and `onlyIfNewerForUrl: halfMindListingUrl(id)`;
      - `observedOn` = the check date, note = `halfMindCheckNote(date)` and url = `halfMindListingUrl(id)`;
      - `createdById` = the row's `processedBy`.
    - **Refresh, unusable date:** a LINKED row whose listing now has `last_verified` null, `"0000-00-00 00:00:00"` or a future date makes no `confirmKennelRunningFor` call, and the row's other fields still update.
    - **Refresh, skipped or stopped:** a `{ skipped: true }` result increments nothing. A `{ stopped: true }` result increments `skippedStopped` and adds no error.
    - **Dead or missing:**
      - a linked listing with `status: "dead"` sets `externalStatus: "dead"` and increments `flaggedDeadOrMissing`;
      - a linked listing absent from a scope response with `truncated: false` sets `externalStatus: "missing"`. With `truncated: true` it doesn't;
      - neither ever calls a stop.
    - **Client errors** for a scope go into `errors`, and that scope makes no writes; other scopes still run.
  - `half-mind-actions.test.ts`:
    - Non-admin callers are refused, and so are non-HALFMIND rows.
    - `linkHalfMindListing`:
      - sets `kennel.halfMindListingId` and makes the row `LINKED` with `matchedKennelId`, `processedBy` and `processedAt`;
      - records a HALF_MIND confirmation only when the row passes the bar at action time (`externalStatus === "alive"` and `externalCheckedAt` within 365 days). It does not pass `onlyIfNewerForUrl`, so a deliberate relink after an unlink records the current check again. A stale row links without one and returns `warning: "Linked; the Half-Mind check is too old to record."`;
      - on a stopped kennel (`{ stopped: true }`), links and returns `warning: "Linked; the kennel is stopped, so the check was not recorded."`;
      - refuses with nothing written when the listing is already on another kennel: `That Half-Mind listing is already linked to <shortName>.`;
      - refuses when the kennel already has a different listing: `<shortName> is already linked to Half-Mind listing #<id>. Unlink it first.`;
      - maps a P2002 on `halfMindListingId` to the first message.
    - `unlinkHalfMindListing` clears `halfMindListingId`, calls `revertHalfMindChecksFor`, and sets the row back to NEW with `matchedKennelId: null`. After that, the sync no longer refreshes the kennel, because no kennel holds the listing id.
    - **Relink, then sync:**
      1. link records the check;
      2. unlink reverts it;
      3. relinking the same listing records the current check again, without the flag;
      4. a sync at the same `lastVerifiedAt` then returns `{ skipped: true }`.
    - `bulkDismissDiscoveries` skips LINKED and ADDED HALFMIND rows.
  - `kennel-confirmations.test.ts`: test the per-listing comparison directly.
    - With `onlyIfNewerForUrl: U`, the write is skipped when a **reverted** HALF_MIND check with `url: U` has an equal or later `observedAt`.
    - It is recorded when the only existing check has a different url, even with a later date.
    - A HALF_MIND write on a stopped kennel returns `{ stopped: true }`.
    - `addListingOnlyKennel`:
      - refuses, returning `duplicateOf`, when the row's best candidate scores ≥ 0.8, unless `confirmNotDuplicate`;
      - creates the kennel with `listingOnly: true`, `halfMindListingId`, `latitude`/`longitude`, `website`, `facebookUrl`, `scheduleNotes` = the cleaned schedule and the given region, through the shared creation helper;
      - creates no alias from the id and no `ScheduleRule`;
      - marks the row `ADDED`, and records the confirmation when the bar passes.
    - `dismissHalfMindListing` refuses LINKED and ADDED rows.
    - The Hash Rego actions refuse HALFMIND rows, with one test each.

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Run the scopes one after another.
  - Use `loadDiscoveryCandidates()` once per sync, and `rankDiscoveryCandidates([listing.name], { lat, lng, country }, …)` for each listing.
  - Upsert by `(externalSource, externalSlug)`.
  - Revalidate changed kennels through `src/lib/kennel-revalidate.ts`. The cron route and server actions both run in a request context.

- [ ] **Step 4: Run** `npx vitest run src/pipeline src/app/admin src/lib`. Expected: PASS. Commit `feat(half-mind): discovery sync and review actions (pilot: Georgia)`.

### Task 7: Admin review screen

**Files:**
- Modify: `src/app/admin/discovery/page.tsx`, `src/components/admin/DiscoveryTable.tsx`

**Interfaces:**
- Consumes: Task 6's actions; the `KennelDiscovery` fields from Task 3.

- [ ] **Step 1: Add a source switch.**
  - The default view shows every row except `HALFMIND`, so the current Hash Rego and AI-discovery view is unchanged. `?source=halfmind` shows Half-Mind rows only.
  - The admin nav badge keeps counting every NEW row, Half-Mind ones included. Accepted: they need review too.
  - With `?source=halfmind`, the page also loads:
    - every visible kennel as `{ id, shortName, fullName, region }` (about 500 rows), for the Link picker's client-side name search;
    - region centroids (`centroidLat`, `centroidLng`) in its existing region query.

    The Add form prefills the region whose centroid is closest to the listing's coordinates.

- [ ] **Step 2: Half-Mind rows show:**
  - name, location, `externalStatus`, the check date, a `Half-Mind listing ↗` link, website/Facebook links and the schedule text;
  - the ranked candidates with scores;
  - by status:

    | Row status | Actions |
    |---|---|
    | NEW | **Link** (pick a candidate, or search any kennel by name when the candidate you need isn't listed); **Add as listing-only kennel** (a form prefilled from the listing name, never the numeric id; a `duplicateOf` answer shows "Looks like <shortName> (score). Add anyway?", which resends with `confirmNotDuplicate`); **Dismiss** |
    | LINKED | **Unlink** |
    | ADDED | a link to the kennel's admin page |

  - a red badge on LINKED and ADDED rows whose `externalStatus` is `"dead"` (`Half-Mind marks this kennel dead`) or `"missing"` (`No longer on Half-Mind`), linking to the kennel's admin status dialog. These are suggestions only.

- [ ] **Step 3: Add a "Sync Half-Mind (pilot)" button** that calls `runHalfMindSync` and shows the result counts.

- [ ] **Step 4: Verify in the browser** against the local DB.
  - Run the sync: about 6 Georgia rows appear, each with candidates.
  - Link Peach Fuzz H3 to `peach-fuzz-h3`. Its kennel page "How we know" then shows `Half-Mind listing checked`, linked, and its card shows `Half-Mind listing checked · Oct 7 · check their page ↗`.
  - Unlink it: the line goes back to `Last run we saw · Mar 4`.
  - "Pine Lake H3" shows Pinelake H3 as a candidate, and Add warns about the duplicate.
  - Add Southeast Xtra H3 as listing-only.
  - Take screenshots for the PR. Commit `feat(admin): Half-Mind review in the discovery queue`.

### Task 8: Listing-only kennels on public pages

**Files:**
- Modify: `src/app/kennels/[slug]/page.tsx`: `generateMetadata`, and pass `listingOnly` to its `KennelStatusLine`. Its query uses `include`, so the new columns arrive without a select change.
- Modify: `src/components/kennels/KennelStatusLine.tsx`: a `listingOnly` prop, passed to `getStatusLine` and used to set `showOwnPage`.
- Modify: `src/components/travel/OtherKennelsSection.tsx`: pass each row's `listingOnly` to `KennelStatusLine`.
- Modify: `src/lib/kennel-how-we-know.ts` (+ test), `src/components/kennels/HowWeKnow.tsx` (coverage `level: "listing"`)
- Modify: `src/app/kennels/page.tsx` (select around lines 44–63) and `src/app/kennels/region/[slug]/page.tsx` (select around lines 85–103). Each adds `listingOnly` and `scheduleNotes`; `halfMindListingId` arrived in Task 4. Evidence comes in through `KENNEL_EVIDENCE_SELECT`.
- Modify: `src/lib/kennel-directory.ts` (+ test): `serializeKennelWithNext` passes `listingOnly` and `scheduleNotes` through.
- Modify: `src/components/kennels/KennelCard.tsx`: `KennelCardData` gains `listingOnly` and `scheduleNotes`. The card passes `listingOnly` to `KennelStatusLine`, which passes it to `getStatusLine` and sets `showOwnPage`.
- Modify: `src/app/sitemap.ts`
- Modify: `src/lib/travel/search.ts`: the select adds `listingOnly` (`halfMindListingId` arrived in Task 4), and Task 1's candidate mapping uses the real value.
- Modify: `.claude/rules/adapter-patterns.md` and `docs/source-onboarding-playbook.md`: note that listing-only kennels are the spec-approved exception to "no sourceless kennels", so audit and onboarding tools leave them alone.

- [ ] **Step 1: Write the failing tests.**
  - `kennel-how-we-know.test.ts`: a listing-only kennel gets coverage `{ level: "listing" }`, rendered `We only know their Half-Mind listing`.
  - The sitemap test: the kennel query's `where` includes `listingOnly: false`.
  - The kennel page metadata: `robots` is `{ index: false, follow: true }` when `listingOnly`, and absent otherwise. Put it in a pure `kennelRobots(listingOnly)` helper so it can be tested.
  - `kennel-directory.test.ts`: `serializeKennelWithNext` passes `listingOnly` and `scheduleNotes` through.
  - `KennelStatusLine.test.ts`: for a listing-only kennel, `ownPageFor` returns the url for an ADMIN `checked` line too. The component passes `showOwnPage` when `listingOnly`.
  - `projections`: a kennel with no `ScheduleRule` yields no Likely or Possible rows. This should already pass; assert it.
  - `selectOtherKennels` (search test): a running listing-only kennel from the real select appears in the bridge.

- [ ] **Step 2: Implement.**
  - The kennel card for a listing-only kennel:
    - shows `Usually: {scheduleNotes}` in its schedule slot when the structured schedule fields are empty;
    - is not dimmed when its state is running;
    - omits the "No upcoming runs" footer, because its status line always shows, with the dated evidence and the link out.

- [ ] **Step 3: Verify in the browser.**
  - The listing-only kennel from Task 7 shows in the directory with `Half-Mind listing checked · Oct 30 · check their page ↗`, and the Half-Mind words are linked.
  - Its page has `<meta name="robots" content="noindex, follow">`, it is absent from `/sitemap.xml`, and it never appears in the Hareline.
  - A Travel search near it shows it under "Other kennels near …" and nowhere else.

- [ ] **Step 4: Run** `npx tsc --noEmit && npm run lint && npm test`. Commit `feat(kennels): listing-only kennels from Half-Mind (noindex, credited)`.

### Task 9: Weekly refresh cron, off by default

The spec says "re-sync verified dates on a schedule (**if permitted**)". The cron therefore ships switched off. The owner turns it on once the maintainer has answered the courtesy note, or after a reasonable wait with no objection. During the pilot, the admin button covers the same work.

**Files:**
- Create: `src/app/api/cron/half-mind-sync/route.ts` (+ test)
- Modify: `vercel.json`, `CLAUDE.md` (the cron list and the environment-variable list)

**Interfaces:**
- Consumes: `verifyCronAuth`, `syncHalfMindDiscovery`.
- Produces: the environment variable `HALF_MIND_SYNC_ENABLED`. Only the exact value `"true"` turns the sync on.

- [ ] **Step 1: Write the failing test.**
  - An unauthorized request gets 401.
  - With the flag unset, an authorized GET returns 200 `{ data: { skipped: "disabled" } }` and never calls the sync.
  - With the flag `"true"`, it calls `syncHalfMindDiscovery()` once and returns `{ data: HalfMindSyncResult }`.
  - A result with errors still returns 200 and reports to Sentry once, with the error count and no row contents. `skippedStopped` alone never reports.

- [ ] **Step 2: Implement it** like `src/app/api/cron/rule-drift/route.ts`. Add `{ "path": "/api/cron/half-mind-sync", "schedule": "0 10 * * 1" }` (Mondays 10:00 UTC) to `vercel.json`. Document `HALF_MIND_SYNC_ENABLED` in `CLAUDE.md`.

- [ ] **Step 3: Run the full checks and the local `next build` against the migrated local DB.** Then run `/simplify` and the pre-PR review loop. Open PR B.
  - The PR body lists the owner steps, the migration dry-run counts and the local-build proof.
  - Note in it that Codex review is unavailable while `~/.codex/config.toml` pins `gpt-5.5`.

---

## Owner steps

1. **Before PR B starts:** answer the open question above.
2. **Before PR B merges:** send Half-Mind's maintainer a short courtesy note, from the contact on their About page. Draft:
   > Hi — I run HashTracks (hashtracks.xyz), a hash run calendar. We already send travelers with empty searches to your finder. We'd like to list kennels your volunteers have verified, credited and linked back to each Half-Mind listing ("Half-Mind listing checked Oct 7"). We'd read your finder's public API about once a week, one request per region, with a User-Agent that names us. If you'd rather we didn't, or want it done differently, just say and we'll follow your lead. Thanks for keeping the directory alive.
3. **After PR B deploys:** press "Sync Half-Mind (pilot)" in `/admin/discovery?source=halfmind`, and link, add or dismiss every Georgia row.
4. **Once the maintainer has answered** (or after a reasonable wait with no objection): set `HALF_MIND_SYNC_ENABLED=true` in Vercel Production to start the weekly refresh.
5. **When the pilot looks right:** add the next scope to `HALF_MIND_SYNC_SCOPES`. A one-line PR. Georgia exercises the listing-only path on one kennel (Southeast Xtra H3), so prefer a next scope with more kennels we lack.

## My calls, to check

- **Bridge trigger:** "few runs" means fewer than 3 shown confirmed + likely rows. Possible rows don't count as runs.
- **Bridge scope:** single-stop searches only. It lists quiet kennels and running listing-only kennels. It leaves out kennels we have never seen (those with schedules already appear under Likely or Possible), listing-only kennels with stale checks, and stopped kennels.
- **Counts:** listing-only kennels count in "running" totals when their check is recent, so every surface keeps one shared predicate.
- **Refresh confirmations:** these are recorded as the admin who linked the listing (`processedBy`). The link was reviewed; only the date is new, and `via = HALF_MIND` shows the origin.
- **Storage:** only listings that pass the bar are stored, plus rows already in the queue. This avoids adding about 1,000 unreviewable rows next to the 590 Hash Rego ones.
- **Dead and missing listings:** these are flags for the owner. A linked kennel keeps its last credited check until it ages out or the owner stops or unlinks it.
- **Running kennels with no rules (R3-1, accepted):** the bridge follows the spec's wording, "quiet and listing-only kennels". A kennel with no schedule rules that a Half-Mind check makes running, and that has no posted run on the trip dates, appears nowhere in Travel. The example is SLUT H3: last run Jul 2, no active rules, Half-Mind check Oct 17. Pilot impact is about nil.
  - Widening the bridge to running kennels that appear in no result row would need a dated line for running kennels too, which Status 1 deliberately hides. That's a follow-up for the four-week Travel review.
- **The deciding test drops every confirmation, not only the Half-Mind one (R3-5):** `isHalfMindDeciding` tests "not running with `lastConfirmedAt: null`". A kennel an older admin check would also keep running can still show the Half-Mind line. That line is honest and credited, so this is accepted.

## Revision log

**R1 adversarial review (2026-11-17): CHANGES REQUIRED, 1 Critical, 7 Important, 11 Minor.** Resolved in this revision:

| Finding | Resolution |
|---|---|
| R1-1 dead kennels invisible | `dead=1` on every scope; `status` mapped; `"missing"` for linked listings absent from a complete scope; tests (Tasks 5–6) |
| R1-2 wrong field types | real types in recon; array-based `cleanHalfMindSchedule` table from fixture values; Peach Fuzz schedule assertion (Task 5) |
| R1-3 uncredited deciding check | `isHalfMindDeciding` shows the credit line even when running; `via` threaded into Travel's caption, HowWeKnow and the stop-refusal copy (Tasks 3–4); owner question added |
| R1-4 no own-page link | `ownPageFor` + `showOwnPage` (Task 2); HALF_MIND lines always link out, and the credit words link to the listing (Task 4); Task 2 Step 5 fixed |
| R1-5 no candidates at ≥0.95 | `rankDiscoveryCandidates` returns the top 3 at any score; kennel search fallback; duplicate guard on Add (Tasks 6–7) |
| R1-6 no undo; source mixing | `unlinkHalfMindListing` + `revertHalfMindChecksFor`; refresh compares against reverted checks too; Dismiss limited to NEW; Hash Rego actions refuse HALFMIND rows (Task 6) |
| R1-7 STATIC_SCHEDULE clears listingOnly | cleared only by real evidence (`lastRunSeenAt`/`nextRunPostedAt`); test (Task 3) |
| R1-8 cron without permission | `HALF_MIND_SYNC_ENABLED`, default off, with the reason (Task 9); owner step 4 |
| R1-9 stale listing-only in bridge | candidates must be quiet, or listing-only and running (Task 1) |
| R1-10 wrong `runStopSearch` names | uses `filtered.*` after adoption and `primary`; select spread fix; null-slug fallback; filters stated not to apply (Task 1) |
| R1-11 wrong file references | real select files, `KennelCardData`, `level: "listing"`, shared `kennel-revalidate.ts`, Review Focus pointers, default admin view stated (Tasks 6–8) |
| R1-12 missing tests | throw/429/HTML, stale `last_verified` on refresh, stopped link, P2002, kennel already linked (Tasks 5–6) |
| R1-13 duplicate confirmations | the newer-than check runs inside `confirmKennelRunningFor`'s transaction after `lockKennel` (Task 6) |
| R1-14 weekly Sentry noise | `skippedStopped` counted, not an error; attribution documented (Tasks 6, 9) |
| R1-15 listing-only copy | schedule cleanup rules; card not dimmed when running; no "No upcoming runs" footer (Tasks 5, 8) |
| R1-16 preview build fails | stated at the top of PR B; local `next build` proof (Task 9) |
| R1-17 stale rows and duplicate listings | bar re-checked at action time; one listing per kennel, duplicates dismissed (Global Constraints, Task 6) |
| R1-18 duplication, rules, research | `loadDiscoveryCandidates` extracted; rules/playbook note; source research picking up Half-Mind rows is accepted as useful (Tasks 6, 8) |
| R1-19 pilot breadth | accepted; owner step 5 prefers a next scope with more kennels we lack |

**R2 re-review (2026-11-17): CHANGES REQUIRED, 0 Critical, 1 Important, 8 Minor.** Resolved in this revision:

| Finding | Resolution |
|---|---|
| R2-1 wrong "no" branch | "If the owner answers no, stop": revise Tasks 1/3/4/8 and re-review; what a "no" version needs is stated (open question, Task 4) |
| R2-2 newest vs deciding | `isHalfMindDeciding` = HALF_MIND and not running without the check; Savannah test; admin table behavior stated (Task 3) |
| R2-3 listing-only with an ADMIN check | listing-only kennels always show a line and the link out (Global Constraints, Tasks 3, 8) |
| R2-4 listing-link plumbing | `halfMindListingId` card/bridge/page plumbing moved into Task 4; `KennelCardData`'s real file; `serialize.ts` and `LikelyCard.tsx` listed |
| R2-5 stopped by error text | `{ stopped: true }` for HALF_MIND callers (Task 6) |
| R2-6 per-kennel comparison | `onlyIfNewerForUrl` compares per listing; the link action doesn't use it (Task 6) |
| R2-7 refresh unusable-date test | added (Task 6) |
| R2-8 search, region, creation helper | the page loads the kennel list and centroids; nearest-centroid region prefill; `kennel-creation.ts` fields (Tasks 6–7) |
| R2-9 bulk dismiss | guarded (Task 6) |
| Hash Rego guard reason | corrected: the narrow guard stays, and the pre-existing GEMINI misuse is a separate follow-up |

**R3 re-review (2026-11-17): APPROVE**, with 5 Minor findings, folded in:

| Finding | Resolution |
|---|---|
| R3-1 bridge leaves out running kennels with no rules | accepted per the spec's wording; SLUT H3 named in "My calls"; widening is a four-week-review follow-up |
| R3-2 `listingOnly` not passed on the bridge and kennel page | both pass it; `KennelStatusLine.tsx` added to Task 8's files |
| R3-3 duplicate `halfMindListingId` additions | removed from Task 8; the kennel page needs no select change (it uses `include`) |
| R3-4 unlink test's reason | rewritten; direct per-listing tests in `kennel-confirmations.test.ts`, plus relink-then-sync |
| R3-5 deciding test drops admin checks too | accepted and noted in "My calls" |
