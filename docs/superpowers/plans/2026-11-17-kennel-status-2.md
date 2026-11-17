# Kennel Status 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Travel search finds few runs, point to the other kennels near the place. List live kennels from Half-Mind that we lack, and record Half-Mind's dated checks of kennels we already have, credited to Half-Mind.

**Architecture:**
- **Travel bridge.** A pure selector (`src/lib/travel/other-kennels.ts`) picks quiet kennels inside a single-stop search radius that the results don't already show. It reuses Status 1's cached evidence and `KennelStatusLine`. Nothing new is stored.
- **Half-Mind listings.** A client for Half-Mind's public finder API (`/api/v1/kennels.php`) feeds `syncHalfMindDiscovery` into the existing `KennelDiscovery` queue (`externalSource: "HALFMIND"`).
  - An admin acts on every row. Linking a row to a kennel records a `RUNNING` confirmation with `via: HALF_MIND`. Adding one creates a listing-only kennel (`Kennel.listingOnly`).
  - A weekly cron refreshes the check dates of rows that are already linked.
  - The pilot covers one region (Georgia), set in code.

The work ships as two PRs:
- **PR A** (Tasks 1–2): the Travel bridge, which works with kennels we already have.
- **PR B** (Tasks 3–8): the Half-Mind import, listing-only kennels and the weekly refresh.

**Tech Stack:** Next.js 16 App Router, Prisma 7 / Postgres, Vitest, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-10-kennel-status-design.md`, "Phase 2: listing kennels from Half-Mind" and "Owner answers" 3–4. Status 1 (sections 1–5) shipped in #2923, #2975 and #2976.

**What recon found (2026-11-17), and how it changes the spec's premise:**
- **The API accepts plain requests.** The spec assumed Half-Mind refuses automated clients (HTTP 406). That holds for its HTML listing pages (`/regionalwebsite/p_list1.php`). The finder at `https://half-mind.com/app/` loads `GET /api/v1/kennels.php`, and that answers plain requests with an honest User-Agent: 200, JSON.
- **Query parameters:** `country`, `state`, `lat`/`lng`/`radius` (miles), `day`, `dead=1`, `q`.
- **Response:** `{ items, count, truncated }`.
- **Item fields:** `id`, `name`, `city`, `state`, `country`, `lat`, `lng` (strings), `current_state` ("Alive and Verified", "Unknown", "UNKNOWN", …), `last_verified` ("2026-10-07 01:44:08" or null), `schedules` (a Python-list string such as `"['Every Month 19:00 All Year']"`), `website`, `facebook`, `email`, `updated` and `details` (a relative listing path).
- **`robots.txt`** disallows only `/us/`.
- **Georgia:** 25 listings. 9 are "Alive and Verified", and 6 of those carry a `last_verified` date from Oct–Nov 2026. Two of the six are kennels on the Status 1 not-running list: Peach Fuzz H3 (Oct 7) and Southern Comfort H3 (Nov 9).

## Global Constraints

- **Honest client:**
  - User-Agent `HashTracks/1.0 (+https://www.hashtracks.xyz)`.
  - No browser rendering, stealth plugin or residential/VPN proxy for Half-Mind.
  - One request per scope, run one after another.
  - On HTTP 403, 406 or 429, or a non-JSON body: record an error and write nothing. Never retry in disguise.
- **Never store or log Half-Mind's `email` field.** No mapped type has it, and error samples list allowed fields only.
- **Import bar:** all four must hold:
  - `current_state` equals "alive and verified", case-insensitive, after trimming;
  - `last_verified` parses to a date within the last 365 days, today counting as day 1;
  - a `website` or `facebook` URL passes `safeUrl`;
  - `lat` and `lng` parse to finite numbers.
- **Nothing published from an automatic match.** A Half-Mind row stays `NEW` until an admin links it, adds it or dismisses it. The sync never sets `MATCHED` and never creates a `SourceKennel`.
- **Credit copy, exact strings:**
  - status line: `Half-Mind listing checked · {d}`;
  - confirmation note: `Half-Mind listing checked {Mon D, YYYY}`;
  - coverage sentence: `We only know their Half-Mind listing`.
  - The listing link is `https://half-mind.com` + `details`. Never write "Confirmed running" for a Half-Mind check.
- **Listing-only kennel:**
  - no `ScheduleRule` rows, so never in Travel predictions or the Hareline;
  - kennel page `robots: { index: false, follow: true }`;
  - left out of `sitemap.ts`;
  - shows its status line even when its state is running.
  - The nightly refresh clears `listingOnly` once the kennel has an enabled `SourceKennel` link.
- **Travel bridge:**
  - heading `Other kennels near {place}`;
  - shown only for single-stop searches whose stop has fewer than 3 confirmed + likely rows;
  - at most 5 kennels, closest first;
  - never mixed into Confirmed / Likely / Possible.
- **Pilot scope:** `[{ country: "USA", state: "GA" }]`. More regions are a one-line change after the owner reviews the pilot.
- **Repo rules:**
  - Dates are stored at UTC noon. Schema changes go through `npm run prisma -- migrate dev`.
  - Tests sit next to source. In a worktree, run vitest with a temporary config that drops the `.claude/worktrees` exclude, and delete it before committing.
  - SonarCloud and Codacy gates apply: no `new RegExp(variable)`, and regex complexity ≤ 20.

## Review Focus

1. **The Half-Mind API breaks.** It may answer with HTML, a 406, `{ "error": … }` or `items` that isn't an array. The sync returns that error, writes no rows and does not throw. *(Task 4, Task 5)*
2. **`last_verified` is unusable.** It may be null, `"0000-00-00 00:00:00"`, unparseable or in the future. The listing then fails the import bar, and a refresh never records a confirmation from it. *(Task 4, Task 7)*
3. **A listing is linked twice.** An admin links a listing whose `halfMindListingId` already belongs to another kennel. The action returns an error, and the confirmation and the discovery row stay unchanged. *(Task 5)*
4. **The bridge shows nothing new.** It is absent when every in-radius kennel is running, or already appears in Likely or Possible. A quiet kennel shown under Possible is not shown again. *(Task 1)*
5. **A listing-only kennel gets a real source.** After the next evidence refresh, `listingOnly` is false, so the page is indexable and in the sitemap. *(Task 3)*

---

## PR A — Travel bridge

### Task 1: Pick the other kennels for a stop

**Files:**
- Create: `src/lib/travel/other-kennels.ts`, `src/lib/travel/other-kennels.test.ts`
- Modify: `src/lib/travel/search.ts` (the `fetchAllVisibleKennels` select, `DestinationResult`, `runStopSearch`, the aggregate)
- Modify: `src/lib/travel/serialize.ts` (+ its test)

**Interfaces:**
- Consumes:
  - `getKennelState`, `KennelEvidence`, `KENNEL_EVIDENCE_SELECT` from `@/lib/kennel-status`;
  - `kennelOwnPageUrl` from `@/lib/safe-url`;
  - `NearbyKennel` (in-radius kennel with `distanceKm`) from `search.ts`.
- Produces:
  - `export const OTHER_KENNELS_LIMIT = 5`
  - `export const FEW_RUNS_THRESHOLD = 3`
  - `export interface OtherKennel { kennelId: string; slug: string; shortName: string; fullName: string; region: string; distanceKm: number; evidence: KennelEvidence; ownPageUrl: string | null; listingOnly: boolean }`
  - `export function shouldShowOtherKennels(confirmedCount: number, likelyCount: number): boolean`
  - `export type OtherKennelCandidate = KennelEvidence & { id: string; slug: string; shortName: string; fullName: string; region: string; website: string | null; facebookUrl: string | null; distanceKm: number; listingOnly: boolean }`
  - `export function selectOtherKennels(nearby: OtherKennelCandidate[], shownKennelIds: ReadonlySet<string>, now: Date, limit?: number): OtherKennel[]`
  - `export function otherKennelsHeading(place: string): string`, which returns `Other kennels near {place}`
  - `export function otherKennelsBrowseLink(kennels: Pick<OtherKennel, "region">[]): { label: string; href: string } | null`
  - `DestinationResult.otherKennels?: OtherKennel[]`
  - `SerializedTravelResults.otherKennels?: SerializedOtherKennel[]` (evidence serialized with `serializeKennelEvidence`).

- [ ] **Step 1: Write the failing tests** in `other-kennels.test.ts`:
  - `shouldShowOtherKennels`: `(0,0)` → true, `(1,1)` → true, `(2,1)` → false, `(0,3)` → false.
  - `selectOtherKennels`:
    - **"keeps quiet kennels, closest first":** given three quiet kennels at 12, 3 and 7 km, it returns them in the order 3, 7, 12.
    - **"drops running, not-seen and stopped kennels":** for example `lastRunSeenAt` 10 days ago; no evidence; `stoppedAt` set.
    - **"drops kennels already shown":** a quiet kennel whose id is in `shownKennelIds` is absent.
    - **"caps at the limit":** 7 quiet kennels → 5.
    - **"keeps listing-only kennels in any state but stopped":** `listingOnly: true` with `lastConfirmedAt` 20 days ago is kept.
    - **"sets ownPageUrl from website, then Facebook":** follows `kennelOwnPageUrl`.
  - `otherKennelsHeading("Savannah")` returns `Other kennels near Savannah`.
  - `otherKennelsBrowseLink`:
    - `[{ region: "Savannah, GA" }, { region: "Atlanta, GA" }]` returns `{ label: "Browse kennels in Savannah, GA", href: "/kennels/region/" + regionNameToSlug("Savannah, GA") }` (the first, closest kennel's region);
    - `[]` returns null.

- [ ] **Step 2: Run** `npx vitest run src/lib/travel/other-kennels.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `other-kennels.ts`.**
  - A candidate qualifies when it is not in `shownKennelIds`, its state is not `stopped`, and either `getKennelState(evidence, now) === "quiet"` or `listingOnly` is true.
  - Sort by `distanceKm` ascending, ties by `shortName`. Slice to `limit`.
  - Until Task 3 adds `Kennel.listingOnly`, callers pass `listingOnly: false`.

- [ ] **Step 4: Wire it into `search.ts`.**
  - Spread `KENNEL_EVIDENCE_SELECT` into the `fetchAllVisibleKennels` select.
  - In `runStopSearch`, when `ctx.wantNearestConfirmed`: after the primary rows are built, if `shouldShowOtherKennels(confirmed.length, likely.length)`, set `destination.otherKennels = selectOtherKennels(primary, idsOf(confirmed, likely, possible), ctx.now)`. Here `primary` is the in-radius list and `idsOf` collects `kennelId`.
  - Leave `otherKennels` unset when it would be empty.
  - Hoist `destinations[0].otherKennels` to `serializedResults.otherKennels` the same way `nearestConfirmed` is hoisted.
  - Add one `search.test.ts` case: a single-stop search with one quiet in-radius kennel and no runs returns it in `destinations[0].otherKennels`. A two-stop search returns none.

- [ ] **Step 5: Run** `npx vitest run src/lib/travel` and `npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 6: Commit** `feat(travel): pick quiet kennels near a thin search (Status 2, bridge data)`.

### Task 2: Show "Other kennels near {place}"

**Files:**
- Create: `src/components/travel/OtherKennelsSection.tsx`. It has no render test: the repo has no React test setup (see `PossibleRow.test.ts`), so its copy and links come from Task 1's tested helpers, and the browser check covers the rest.
- Modify: `src/app/travel/page.tsx` (both the search and saved-trip render paths)
- Modify: `src/components/kennels/KennelStatusLine.tsx`, `src/components/kennels/OwnPageLink.tsx` (the `surface` union)
- Modify: `src/lib/analytics.ts` (`kennel_own_page_clicked.surface` gains `"travel"`)

**Interfaces:**
- Consumes: `SerializedOtherKennel`, `otherKennelsHeading`, `otherKennelsBrowseLink` (Task 1), `KennelStatusLine`.
- Produces: `export function OtherKennelsSection(props: Readonly<{ place: string; kennels: SerializedOtherKennel[] }>)`. It returns null for an empty list.

- [ ] **Step 1: Add `"travel"` to the `surface` unions** in `KennelStatusLine`, `OwnPageLink` and `analytics.ts`. Then run `npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 2: Implement the section.**
  - Match `NearestConfirmedSection`: a `TravelHintBadge` with glyph `○` and label `Kennels in your area`, then a heading row with `otherKennelsHeading(place)`.
  - Then one compact row per kennel: the `shortName` linked to `/kennels/{slug}`, the full name, the distance rounded to whole km (`3 km`), and `<KennelStatusLine evidence ownPageUrl kennelSlug surface="travel" />`.
  - Add a footer link from `otherKennelsBrowseLink(kennels)`.

- [ ] **Step 3: Place it in `page.tsx`** after `TravelResults`, in both the empty-state and non-empty branches of the search path and in the saved-trip path: `{serializedResults.otherKennels && <OtherKennelsSection place={extractCityName(...)} kennels={serializedResults.otherKennels} />}`. `place` is the same value `EmptyStates` receives.

- [ ] **Step 4: Verify in the browser** (preview tools, local DB copy). Find a destination with a quiet kennel inside the radius: query the local DB for kennels whose `lastRunSeenAt` is 90–365 days old, and search near one.
  - The section appears below the results with at most 5 rows.
  - "check their page ↗" opens the kennel's site.
  - A destination whose kennels are all running shows no section.
  - Take a screenshot for the PR.

- [ ] **Step 5: Run** `npx tsc --noEmit && npm run lint && npm test`, then commit `feat(travel): "Other kennels near" section for thin searches`.

- [ ] **Step 6: Open PR A.**

---

## PR B — Half-Mind listings

### Task 3: Schema, cached "via", and listing-only evidence

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
  - `KennelDiscovery.externalStatus String?`, `externalCheckedAt DateTime?`, `facebookUrl String?`
  - `KennelEvidence.lastConfirmedVia: "ADMIN" | "HALF_MIND" | null`, added to `KENNEL_EVIDENCE_SELECT` and the serialize/parse pair.
  - The `StatusLine` `"checked"` variant gains `via: "ADMIN" | "HALF_MIND"`.
  - `getStatusLine(e, now?, opts?: { listingOnly?: boolean })`

- [ ] **Step 1: Write the failing tests.**
  - `kennel-status.test.ts`:
    - `formatStatusLine({ kind: "checked", via: "HALF_MIND", date })` returns `Half-Mind listing checked · Oct 7`. With `via: "ADMIN"` it still returns `Checked running · Oct 7`.
    - `getStatusLine(runningEvidence, now, { listingOnly: true })` returns the `"checked"` line (not null) when `lastConfirmedAt` is set. A listing-only kennel with no confirmation returns `{ kind: "never" }`.
  - `kennel-evidence.test.ts`:
    - the SQL selects the newest RUNNING confirmation's `via` into `"lastConfirmedVia"`, and compares it with `IS DISTINCT FROM`;
    - the SQL sets `"listingOnly"` false when an enabled `SourceKennel` exists: the text contains `"listingOnly" = k."listingOnly" AND NOT EXISTS`, and the guard joins `"Source"` on `enabled = true`.

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Edit the schema and create the migration** with `npm run prisma -- migrate dev --name kennel_status_2_half_mind` against the local DB. Review the SQL: additive columns, one enum, one unique index, no data changes.

- [ ] **Step 4: Implement.**
  - In `refreshKennelEvidence`, the `confirmations` CTE adds `(array_agg(c.via ORDER BY c."observedAt" DESC, c."createdAt" DESC) FILTER (WHERE c.kind = 'RUNNING'))[1] AS "lastConfirmedVia"`. The `UPDATE` writes it, and its change guard compares it.
  - In the same `UPDATE`, set `"listingOnly" = k."listingOnly" AND NOT EXISTS (SELECT 1 FROM "SourceKennel" sk JOIN "Source" s ON s.id = sk."sourceId" WHERE sk."kennelId" = k.id AND s.enabled = true)`. Add `OR k."listingOnly" IS DISTINCT FROM <that expression>` to the change guard.
  - In `kennel-status.ts`:
    - `getStatusLine` attaches `via: e.lastConfirmedVia ?? "ADMIN"` to `"checked"`;
    - with `opts.listingOnly` it returns the checked line instead of null for running kennels;
    - `formatStatusLine` picks the copy by `via`.

- [ ] **Step 5: Run** `npx tsc --noEmit` and fix every flagged `KennelEvidence` literal (add `lastConfirmedVia: null`). Run `npx vitest run src/lib src/pipeline`. Expected: PASS.

- [ ] **Step 6: Dry-run the migration against prod** inside `BEGIN; … ROLLBACK;`, following `.claude/rules/prod-data-ops.md`. Report the per-statement counts in the PR. Then commit `feat(kennel-status): ConfirmationVia, listing-only kennels, Half-Mind discovery fields`.

### Task 4: Half-Mind client

**Files:**
- Create: `src/adapters/half-mind/client.ts`, `src/adapters/half-mind/client.test.ts`
- Create: `src/adapters/half-mind/fixtures.ts`, built from the 2026-11-17 Georgia response with every `email` removed and names kept.

**Interfaces:**
- Consumes: `safeFetch` from `src/adapters/safe-fetch.ts`; `safeUrl` from `@/lib/safe-url`.
- Produces:
  - `export const HALF_MIND_API_URL = "https://half-mind.com/api/v1/kennels.php"`
  - `export const HALF_MIND_USER_AGENT = "HashTracks/1.0 (+https://www.hashtracks.xyz)"`
  - `export interface HalfMindScope { country: string; state?: string }`
  - `export interface HalfMindListing { id: string; name: string; city: string | null; state: string | null; country: string; latitude: number | null; longitude: number | null; currentState: string; lastVerifiedAt: Date | null; schedule: string | null; website: string | null; facebookUrl: string | null; listingUrl: string }`
  - `export function parseHalfMindResponse(body: unknown): { listings: HalfMindListing[]; truncated: boolean; errors: string[] }`
  - `export function cleanHalfMindSchedule(raw: unknown): string | null`
  - `export function passesImportBar(l: HalfMindListing, now: Date): boolean`
  - `export function isHalfMindDead(l: HalfMindListing): boolean` (`currentState` contains "dead", case-insensitive)
  - `export async function fetchHalfMindListings(scope: HalfMindScope): Promise<{ listings: HalfMindListing[]; truncated: boolean; errors: string[] }>`

- [ ] **Step 1: Write the failing tests.**
  - `parseHalfMindResponse(fixture)`:
    - returns 25 listings;
    - `Peach Fuzz H3` has `lastVerifiedAt` = `2026-10-07T12:00:00Z` (date part at UTC noon), `latitude`/`longitude` as numbers, and `listingUrl` = `https://half-mind.com/regionalwebsite/p_list1.php?ID=19`;
    - no listing object has an `email` key.
  - It returns `errors.length === 1` and no listings for each of: `"<html>"`, `{ error: "x" }`, `{ items: "nope" }`. A row missing `id` or `name` is skipped with one error naming the row index, not its contents.
  - `lastVerifiedAt` is null for `null`, `"0000-00-00 00:00:00"`, `"garbage"` and a date after `now`.
  - `cleanHalfMindSchedule`:

    | Input | Output |
    |---|---|
    | `"['Every Month 19:00 All Year']"` | `"Every Month 19:00 All Year"` |
    | `"['Every Year 13:00 ST', '18:30 Summer']"` | `"Every Year 13:00 ST · 18:30 Summer"` |
    | `"[]"`, `""`, `null` | `null` |

    Use string operations, not a regex with nested quantifiers (Sonar S5852).
  - `passesImportBar`, with `now` = 2026-11-17: true for Peach Fuzz; false for Black Sheep (no date), for "Unknown" kennels, for a 2025-10-01 check (more than 365 days old), and for a listing with no website or Facebook.
  - `fetchHalfMindListings` (mock `safeFetch`):
    - sends the User-Agent and `Accept: application/json` with `country` and `state` query params;
    - a 406 response returns `errors` = `["Half-Mind API returned HTTP 406"]` and makes no second request.

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Validate at runtime: `items` must be an array of objects.
  - Map only the allowed fields.
  - Make `listingUrl` absolute from `details`, and accept only paths that start with `/regionalwebsite/`.
  - Error messages carry counts and row indexes, never row contents.

- [ ] **Step 4: Verify live** (`.claude/rules/live-verification.md`) with a throwaway script, not committed, that calls `fetchHalfMindListings({ country: "USA", state: "GA" })`.
  - Report the count, how many pass the bar, and one sample with all fields.
  - Expected: about 25 listings and about 6 passing the bar. If the live shape differs from the fixture, update the fixture.

- [ ] **Step 5: Commit** `feat(half-mind): honest client for Half-Mind's finder API`.

### Task 5: Sync into the discovery queue, plus the review actions

**Files:**
- Create: `src/pipeline/half-mind-discovery.ts` (+ test)
- Modify: `src/pipeline/kennel-discovery.ts`. Extract the name + geo scoring from `computeMatchResult` into `export function scoreDiscoveryCandidates(names: string[], geo: DiscoveryGeoContext, candidates: FuzzyCandidate[], geoMap: Map<string, KennelGeoData>): MatchResult`, and export `MatchResult`, with no change in Hash Rego behavior. The existing `kennel-discovery.test.ts` must pass unchanged.
- Modify: `src/lib/kennel-confirmations.ts`. `confirmKennelRunningFor` gains a trailing `opts?: { via?: "ADMIN" | "HALF_MIND" }`, default `ADMIN`.
- Create: `src/app/admin/discovery/half-mind-actions.ts` (+ test)

**Interfaces:**
- Consumes: Task 4's client; `scoreDiscoveryCandidates`; `confirmKennelRunningFor`; the kennel-creation helper in `src/app/admin/shared/kennel-creation.ts`.
- Produces:
  - `export const HALF_MIND_EXTERNAL_SOURCE = "HALFMIND"`
  - `export const HALF_MIND_SYNC_SCOPES: HalfMindScope[] = [{ country: "USA", state: "GA" }]`
  - `export function halfMindCheckNote(checkedAt: Date): string`, which returns `Half-Mind listing checked Oct 7, 2026`
  - `export interface HalfMindSyncResult { fetched: number; passedBar: number; created: number; updated: number; refreshedChecks: number; deadLinked: number; errors: string[] }`
  - `export async function syncHalfMindDiscovery(scopes?: HalfMindScope[], now?: Date): Promise<HalfMindSyncResult>`
  - Server actions:
    - `runHalfMindSync()`
    - `linkHalfMindListing(discoveryId: string, kennelId: string)`
    - `addListingOnlyKennel(discoveryId: string, data: { shortName: string; fullName: string; regionId: string })`
    - each returns `{ success: true } | { error: string }`, plus `kennelId` on add.

- [ ] **Step 1: Write the failing tests.**
  - `half-mind-discovery.test.ts` mocks prisma and the client.
  - **Bar filter:** a listing that passes the bar and isn't stored is created with `status: "NEW"`, `externalSource: "HALFMIND"` and `externalSlug` = the Half-Mind id. It carries `externalStatus`, `externalCheckedAt`, `schedule`, `facebookUrl`, `externalUrl` = `listingUrl`, `matchScore` and `matchCandidates`. A listing that fails the bar and isn't stored writes nothing.
  - **Existing rows:** an existing row of any status gets its fields updated and keeps its status.
  - **No auto-link:** the sync never writes `status: "MATCHED"` and never touches `SourceKennel`, even at a 1.0 match.
  - **Refresh, newer check:** for a kennel with `halfMindListingId` = the listing id, a newer `lastVerifiedAt` that passes the bar makes `confirmKennelRunningFor` run once with `via: "HALF_MIND"`. Its `observedOn` is the check date, its note is `halfMindCheckNote(date)` and its url is the listing URL. `createdById` is the discovery row's `processedBy`.
  - **Refresh, no newer check:** an equal or older date makes no call.
  - **Dead listing:** a linked listing whose state is dead increments `deadLinked` and records `externalStatus`. It never calls `stopKennelFor`.
  - **Client errors:** these go into `errors`, and that scope makes no writes.
  - `half-mind-actions.test.ts`:
    - non-admin callers are refused;
    - `linkHalfMindListing` sets `kennel.halfMindListingId`, makes the discovery `LINKED` with `matchedKennelId`, `processedBy` and `processedAt`, and records the HALF_MIND confirmation;
    - a `halfMindListingId` already set on another kennel returns `{ error: "That Half-Mind listing is already linked to <shortName>." }` and writes nothing;
    - `addListingOnlyKennel` creates the kennel with `listingOnly: true`, `halfMindListingId`, `latitude`/`longitude`, `website`, `facebookUrl`, `scheduleNotes` = the cleaned schedule and the region given. It marks the row `ADDED`, records the confirmation and creates no `ScheduleRule`.

- [ ] **Step 2: Run the tests.** Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Run the scopes one after another.
  - Load candidate kennels and aliases the same way `syncKennelDiscovery` does.
  - Score with `scoreDiscoveryCandidates([listing.name], { lat, lng, country }, …)`.
  - Upsert by `(externalSource, externalSlug)`.
  - For the refresh, the "latest HALF_MIND check" is the newest un-reverted `RUNNING` confirmation with `via: HALF_MIND` for that kennel. Skip kennels that are stopped: `confirmKennelRunningFor` refuses them; count those in `errors` as `"<shortName> is stopped; Half-Mind check not recorded"`.
  - Revalidate the kennel page and directory the way `status-actions.ts` does.

- [ ] **Step 4: Run** `npx vitest run src/pipeline src/app/admin/discovery src/lib/kennel-confirmations.test.ts`. Expected: PASS. Commit `feat(half-mind): discovery sync and review actions (pilot: Georgia)`.

### Task 6: Admin review screen

**Files:**
- Modify: `src/app/admin/discovery/page.tsx` and its client table component (find it from the page's imports)

**Interfaces:**
- Consumes: Task 5's actions; `KennelDiscovery` fields from Task 3.

- [ ] **Step 1: Add a source filter.** Choices are "Hash Rego" and "Half-Mind", default "Hash Rego", so the existing view is unchanged. Keep it in the URL as `?source=halfmind`.

- [ ] **Step 2: Half-Mind rows show:**
  - name, city/state, `externalStatus`, the check date, a `Half-Mind listing ↗` link, website/Facebook links, schedule text and the top match candidates with scores;
  - three actions: **Link to kennel** (candidate picker), which calls `linkHalfMindListing`; **Add as listing-only kennel**, a form prefilled with shortName, fullName and the nearest region, which calls `addListingOnlyKennel`; and the existing **Dismiss**;
  - a red `Half-Mind marks this kennel dead` badge on linked rows whose `externalStatus` contains "dead", with a link to the kennel's admin status dialog. That link is a suggestion only.

- [ ] **Step 3: Add a "Sync Half-Mind (pilot)" button** that calls `runHalfMindSync` and shows the result counts.

- [ ] **Step 4: Verify in the browser** against the local DB.
  - Run the sync: about 6 Georgia rows appear.
  - Link Peach Fuzz H3 to `peach-fuzz-h3`: its kennel page then shows a `Half-Mind listing checked Oct 7, 2026` confirmation, linked.
  - Add one unmatched row as listing-only.
  - Take screenshots for the PR. Commit `feat(admin): Half-Mind review in the discovery queue`.

### Task 7: Listing-only kennels on public pages

**Files:**
- Modify: `src/app/kennels/[slug]/page.tsx` (`generateMetadata`, status line `opts`)
- Modify: `src/lib/kennel-how-we-know.ts` (+ test), `src/components/kennels/HowWeKnow.tsx`
- Modify: `src/components/kennels/KennelCard.tsx`, `src/components/kennels/KennelStatusLine.tsx` (pass `listingOnly`)
- Modify: `src/lib/kennel-directory.ts` (+ test) (select `listingOnly`)
- Modify: `src/app/sitemap.ts`
- Modify: `src/lib/travel/search.ts` (`fetchAllVisibleKennels` selects `listingOnly`; Task 1's candidate mapping passes it through)

- [ ] **Step 1: Write the failing tests.**
  - `kennel-how-we-know.test.ts`: a listing-only kennel gets coverage `{ kind: "listing" }`, rendered as `We only know their Half-Mind listing`. A HALF_MIND confirmation item has `detail` = `Half-Mind listing` and `url` = the confirmation url.
  - A sitemap test, or a new one: the kennel query's `where` includes `listingOnly: false`.
  - The kennel page metadata test, or a new one: `robots` is `{ index: false, follow: true }` when `listingOnly`, and absent otherwise.
  - `selectOtherKennels`: a listing-only candidate whose `listingOnly: true` comes from the select is kept (extends Task 1's case).
  - `projections`: a kennel with no `ScheduleRule` yields no Likely or Possible rows. Assert this; it should already pass.

- [ ] **Step 2: Implement.**
  - The kennel card shows `Usually: {scheduleNotes}` in its schedule slot for listing-only kennels when the structured schedule fields are empty.
  - `KennelStatusLine` receives `listingOnly` and passes `{ listingOnly }` to `getStatusLine`.

- [ ] **Step 3: Verify in the browser.**
  - The listing-only kennel from Task 6 shows in the directory with its `Half-Mind listing checked · …` line.
  - Its page has `<meta name="robots" content="noindex, follow">`, it is absent from `/sitemap.xml`, and it never appears in the Hareline.
  - A Travel search near it shows it under "Other kennels near …" and nowhere else.

- [ ] **Step 4: Run** `npx tsc --noEmit && npm run lint && npm test`. Commit `feat(kennels): listing-only kennels from Half-Mind (noindex, credited)`.

### Task 8: Weekly refresh cron

**Files:**
- Create: `src/app/api/cron/half-mind-sync/route.ts` (+ test)
- Modify: `vercel.json`, `CLAUDE.md` (the cron list under `vercel.json`)

**Interfaces:**
- Consumes: `verifyCronAuth`, `syncHalfMindDiscovery`.

- [ ] **Step 1: Write the failing test.**
  - An unauthorized request gets 401.
  - An authorized GET calls `syncHalfMindDiscovery()` once and returns `{ data: HalfMindSyncResult }`.
  - A result with errors still returns 200 and reports to Sentry once, with the error count and no row contents.

- [ ] **Step 2: Implement it** like `src/app/api/cron/rule-drift/route.ts`. Add `{ "path": "/api/cron/half-mind-sync", "schedule": "0 10 * * 1" }` (Mondays 10:00 UTC) to `vercel.json`.

- [ ] **Step 3: Run the full checks, then run `/simplify` and the pre-PR review loop.** Open PR B.
  - The PR body lists the owner steps below and the migration dry-run counts.
  - Note in it that Codex review is unavailable while `~/.codex/config.toml` pins an unsupported model.

---

## Owner steps

1. **Before PR B merges:** send Half-Mind's maintainer a short courtesy note, from the contact on their About page. Draft:
   > Hi — I run HashTracks (hashtracks.xyz), a hash run calendar. We already send travelers with empty searches to your finder. We'd like to list kennels your volunteers have verified, credited and linked back to each Half-Mind listing ("Half-Mind listing checked Oct 7"). We'd read your finder's public API about once a week, one request per region, with a User-Agent that names us. If you'd rather we didn't, or want it done differently, just say and we'll follow your lead. Thanks for keeping the directory alive.
2. **After PR B deploys:** press "Sync Half-Mind (pilot)" in `/admin/discovery?source=halfmind`, and link, add or dismiss every Georgia row.
3. **When the pilot looks right:** add the next scope to `HALF_MIND_SYNC_SCOPES`. A one-line PR.

## My calls, to check

- **Bridge trigger:** "few runs" means fewer than 3 confirmed + likely rows for the stop. Possible rows don't count as runs.
- **Bridge scope:** single-stop searches only, the same rule as "Nearest confirmed runs". It lists quiet kennels and listing-only kennels, not kennels we have never seen. Those with schedules already appear under Likely or Possible.
- **Running evidence:** a Half-Mind "Alive and Verified" check counts as running evidence, like an admin confirmation. Peach Fuzz H3 becomes Running from its Oct 7 check, and its card then shows no line, the same as any running kennel. Listing-only kennels always show their line, because it's the only evidence we have.
- **Counts:** listing-only kennels count in "running" totals (homepage, region pages) when their check is recent, so every surface keeps one shared predicate.
- **Refresh confirmations:** weekly refresh confirmations are recorded as the admin who linked the listing (`processedBy`). The link was reviewed; only the date is new.
- **Storage:** only listings that pass the bar are stored, plus rows already in the queue. This avoids adding about 1,000 unreviewable rows next to the 590 Hash Rego ones.
