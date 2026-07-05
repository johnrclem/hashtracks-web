# Cowork Handoff Retro — Harrier Central config-only BATCH (10 kennels 🇧🇷🏴󠁧󠁢󠁥󠁮󠁧󠁿🏴󠁧󠁢󠁳󠁣󠁴󠁿🇫🇷🇳🇱🇩🇪) + Hua Hin Full Moon predecessor — 2026-07-02

Feedback from the Claude Code implementation session that shipped the `2026-07-01-hc-batch-10.md`
handoff (10 config-only `HARRIER_CENTRAL` kennels in one PR) plus its single-kennel predecessor
`2026-07-01-h2fmh3.md` (Hua Hin Full Moon H3). Both are the same pattern the loop has now shipped a
dozen times — GUID-filtered `HarrierCentralAdapter`, zero new adapter code — so the *onboarding* half
held with almost no surprises. The value this run added was almost entirely **downstream of the
onboarding**: a reconcile-semantics finding that changed the backfill decision for the whole batch, and
a full **prod disk-full outage** that the batch's own writes triggered — which turned into a durable
`ScrapeLog` retention job and a Railway volume fix. Three PRs, one genuine production incident,
cleanly resolved.

**PRs produced:**
- **h2fmh3** (single kennel, config-only HC + 12-run backfill): [PR #2490](https://github.com/johnrclem/hashtracks-web/pull/2490) (merged). One review round (no substantive findings).
- **HC batch of 10** (6 new `region.ts` METROs + 10 kennels/aliases/sources + 10 self-hosted logos + **10** history backfills = 956 rows): [PR #2526](https://github.com/johnrclem/hashtracks-web/pull/2526) (merged). Two review rounds — the SH3-DE dead alias, the Aberdeen Ireland geocode pin, and two same-day double-header collapses (all fixed in a follow-up commit); Gemini's `\b`-on-accented-token flag verified as a false positive.
- **ScrapeLog retention GC** (spun out of the disk incident): [PR #2529](https://github.com/johnrclem/hashtracks-web/pull/2529) (merged). Three review rounds — an O(N²) re-sort-per-batch (Gemini), and a SUCCESS-baseline-wipe on long outages (Codex), both fixed.

**Outcome:** All 11 kennels live — **999 canonical events** total (h2fmh3 14, then bnh3 6 · newcastle 107 · aberdeen 268 · plympton 126 · toulouse 5 · tnth3 218 · dafth3 45 · filth 113 · sembach 47 · beerspoke 50). Every page returns HTTP 200 with backfilled history + current upcoming. Prod DB healthy on a resized 1 GB volume (was 500 MB, 99.4% full).

---

## The loop is working — previous retro discipline LANDED

1. **Config-only HC, GUID-filtered, every metadata field held.** All 10 GUIDs resolved live; `publicKennelId` + `defaultKennelTag` + `defaultTitle` + `staleTitleAliases` per the Bandung template; foundedYears (Aberdeen 1983, Sembach 1999, Toulouse 2002), hashCash, schedules all shipped as written. [reference_harrier_central_getevents_future_only]
2. **`upcomingOnly` + backfill are one contract** (Bandung #2340) — and this run PROVED the mechanism from first principles (see §New-1). Post-merge scrapes returned `cancelled=0` on every source.
3. **Targeted post-merge seed, never a full `db seed`.** Scoped `seedKennels`-style one-shot on just this batch's subset (6 regions + 10 kennels + aliases + sources + links); other sources' prod `config` untouched. [feedback_post_merge_config_to_prod_targeted]
4. **HC `global-runs` past-window pull, exactly as documented** — `?isFuture=0` with `min/maxEventDate` (both REQUIRED), windowed, filtered client-side on `PublicKennelId`, rows under `.runs`. [reference_hc_global_runs_past_backfill]
5. **Frozen-JSON H7 backfill + magic-byte logos.** All 10 archives frozen to `scripts/data/<code>-history.json` with dumb loaders; logos self-hosted, extension confirmed by magic bytes (2 AVIF: bnh3 + toulouse; 8 PNG — the handoff's prediction was exactly right). [reference_backfill_must_route_through_merge_pipeline]
6. **Worktree discipline** — ran the whole batch from an isolated worktree on `origin/main`; the one slip (first seed edits landed on the main-repo copies) was caught immediately by `git status` and relocated via patch. [feedback_worktree_bash_cwd_resets_to_main]

---

## What the handoff got RIGHT (keep doing)

1. **Batch-as-one-PR was the right call.** 10 kennels sharing one adapter + one region-edit surface + one review cycle is far cheaper than 10 separate onboards, and the shared `region.ts` palette/inference edits were easier to keep consistent in one diff.
2. **Collision pre-clearing paid off.** The handoff's kennelCode calls were all correct: `sembach-h3`/`beerspoke-h3` (city-coded to dodge Stuttgart `sh3-de` / Black Sheep `bsh3`), bare `NH3`/`AH3`/`PH3`/`TH3`/`SH3`/`BSH3` omitted. Verified against the current tree at build.
3. **Region-reuse vs new-metro was correct** — 6 new METROs (São Paulo, Newcastle, Plymouth, Aberdeen, Toulouse, Kaiserslautern), 4 reuse (FILTH→Amsterdam, New Town/DAFT/BeerSpoke→Edinburgh). The "don't add `newcastle`/`aberdeen`/`plymouth` to UK inference — they resolve to Australia/US and the seed carries explicit `country`" Warsaw-retro rule held. [feedback_new_country_region_map_gotchas]
4. **Live-verify caught real drift.** The handoff's "upcoming?" snapshot was a day stale; by build **Newcastle had dropped to 0 upcoming** (its weekly run had just passed). Because the batch backfilled *all 10* (§New-1), Newcastle still shipped with 107 past runs instead of an empty page.

---

## What was NEW this run (the durable lessons)

### New-1 · HC is future-only → EVERY HC kennel needs `upcomingOnly` + a backfill, not just the 0-upcoming ones
The handoff proposed backfilling only the 3 kennels showing 0 upcoming (bnh3/filth/sembach) and leaving the other 7 "live-only" with `upcomingOnly` omitted. Reading `reconcile.ts:140–147,162–177,276–286` disproved that split: the HC adapter is **future-only**, and reconcile cancels any sole-source CONFIRMED event in `[timeMin, timeMax]` the current scrape doesn't return. **Without `upcomingOnly`, `timeMin = now − scrapeDays`**, so a live-only kennel's runs get **CANCELLED the day after they happen** (the future feed never returns them again) — the kennel would only ever display upcoming runs. `upcomingOnly:true` clamps `timeMin = now`, protecting past events. So the correct rule is: **every HC kennel gets `upcomingOnly:true` AND a backfill** (the backfill to seed history, the flag to keep it). Shipped all 10 that way; post-merge `cancelled=0` on all 10 confirmed it. → [[reference_harrier_central_getevents_future_only]] updated.

### New-2 · Backfill same-day double-headers collapse in merge unless the 2nd row differs on BOTH startTime and runNumber
`merge.ts:1494–1504`: a second same-`(kennel,date)` row in the same batch is treated as an UPDATE (not a new canonical) when it shares `startTime` **OR** `runNumber` with the first. Two genuine double-headers would have silently lost a canonical: tnth3 2023-10-20 (#1992 "2000th Weekend" + #1993 "Red Dress", both 18:30) and plympton 2025-02-23 (memorial special + #2308 regular, both run 2308). Fixed by making each pair differ on both fields with a defensible edit (drop the umbrella's `startTime`; drop the memorial's `runNumber`). Caught by Codex on #2526. → new memory [[reference_backfill_same_day_double_header_collapse]].

### New-3 · A country coord-scrub bbox contains its neighbors in the same lat/lng band
The UK bbox (lat 49.8–61, lng −8.7–2.1) contains **all of Ireland**, so an Aberdeen HC geocode-fail pin that landed in County Tipperary (52.375, −7.927 — 669 km from Aberdeen) passed the bbox untouched. The bbox catches ocean/continent misplacements but not an adjacent-country pin. Fix: after the bbox scrub, add a per-kennel **home-metro distance scan** (flag > ~150 km) and drop those coords for re-geocoding. Caught by the Claude reviewer on #2526. → new memory [[reference_country_bbox_neighbor_overlap]].

### New-4 · A stale snapshot is not ground truth — re-verify at build, adapt the plan
The handoff's history-depth estimates were routinely wrong because HC only holds **HC-join-forward**, not lifetime: h2fmh3 estimated ~44 runs, recovered 12; Newcastle "11 upcoming" → 0. The build must report the *true* recoverable depth and adapt the `upcomingOnly`/backfill decision to live data, never to the day-old handoff column. [feedback_verify_handoff_backfill_feasibility]

### New-5 · Alias that lowercases to an existing kennelCode is DEAD
`SH3-DE` was added as a Sembach alias, but `sh3-de` is Stuttgart's kennelCode, and `resolveKennelTag` checks kennelCodes before aliases → the alias was unreachable (and would misroute if ever emitted). Renamed to `SH3-KL`. The lesson: a region-suffixed alias must be checked against **existing kennelCodes**, not just other aliases. Caught by Codex on #2526.

### New-6 · The batch's own writes exposed an unbounded-table + undersized-volume incident
Applying 956 backfilled events + 10 scrapes tipped the Railway Postgres volume over — **`No space left on device` on every prod write** (a whole-app outage, not just the batch). Root-causing it produced three durable outcomes:
- **`ScrapeLog` had no retention** — 54k rows / 59 MB of pure churn (one row per source per scrape, forever). Shipped a keep-30-per-source GC as a daily cron (#2529), mirroring `travel-draft-gc`. Cleared 43,998 rows on first run.
- **The GC itself needed two review-driven fixes**: rank the surplus **once** (not a `row_number()` re-sort inside the delete loop — O(N²) on a disk already under pressure, Gemini); and add a **SUCCESS-only quota** (10/source) alongside the overall 30, or a source with a >30-scrape outage streak loses its entire `health.ts` baseline, silently disabling regression detection AND auto-resolving stale trend alerts (Codex). Validated the two-window-function SQL against a real local Postgres before shipping.
- **The volume was 500 MB and never actually expanded** despite earlier belief — pinned down only via the **Railway CLI** (`railway volume list --json` → `sizeMB:500, currentSizeMB:497`). `pg_database_size` (314 MB) hid it because the cap includes WAL/bloat/temp. Every `VACUUM FULL` failed for a 3 MB headroom until the volume was bumped to 1 GB; then it completed in 0.08 s and reclaimed ScrapeLog 59 → 11 MB (DB 314 → 266 MB). → new memory candidates: unbounded-churn-table retention; and "trust the infra CLI, not `pg_database_size`, for disk-full."

---

## Process notes / memory candidates

- **New memories written:** [[reference_backfill_same_day_double_header_collapse]], [[reference_country_bbox_neighbor_overlap]].
- **Reinforced:** [[reference_harrier_central_getevents_future_only]] (upcomingOnly now "all HC kennels", not "backfill kennels"), [[feedback_post_merge_config_to_prod_targeted]], [[feedback_worktree_bash_cwd_resets_to_main]], [[feedback_verify_handoff_backfill_feasibility]].
- **Candidate not yet written:** an ops note — "ScrapeLog/RawEvent are unbounded churn tables; ScrapeLog now has a GC cron (03:30 UTC), RawEvent does not (deletion is unsafe for re-scraping sources — only `eventId IS NULL` orphans + past rows from `upcomingOnly` sources are prunable)"; and "on Railway disk-full, `railway volume list --json` is authoritative, `pg_database_size` is not."
- **Tooling first this run:** installed the **Railway CLI** (`npm i -g @railway/cli`) and linked `perfect-growth` — the fastest path to the volume metric and the eventual `railway open` deep-link to the (hard-to-find, canvas-node) Volume settings. Worth keeping linked for future infra checks.
- **Two harness slips** (not code): a handful of malformed tool calls mid-session, and the first seed edits landing on main-repo paths — both self-corrected, neither reached a commit.
