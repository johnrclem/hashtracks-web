# Facebook Source Support — Use Cases & Options Strategy

> **Status:** approved 2026-04-29. Append-only decision log at the bottom.
> **Audience:** anyone touching FB-related kennels, sources, or roadmap items.
> **Read this first** if you're about to suggest "let's just scrape Facebook" — there's a written reason we don't, and a written reason the one exception (Claude dispatch pilot) is the way it is.

## Context

HashTracks treats Facebook as a **coordination channel** today, not a data source. We have three layers of Facebook integration in production:

1. **Profile enrichment** — 149 kennels have `Kennel.facebookUrl` populated (contact link in `SocialLinks` only; no data flows from it).
2. **STATIC_SCHEDULE adapter** — 32 active sources point at Facebook URLs but the events are generated locally from a hand-authored RRULE. The FB URL is a label/fallback location, not actually fetched. Reference: [`src/adapters/static-schedule/adapter.ts`](../src/adapters/static-schedule/adapter.ts), [`source-onboarding-playbook.md`](source-onboarding-playbook.md) line 218.
3. **Manual event creation** — Admin can hand-create events for FB-only kennels (e.g. Rumson's earliest pattern before STATIC_SCHEDULE existed).

We've intentionally avoided live FB scraping at scale because of ToS, anti-bot, and account-ban risk. The roadmap calls out a future `FACEBOOK_EVENTS` adapter ([`roadmap.md`](roadmap.md) line 917) and this doc is the framework that determines when (and how) it ships.

This doc was hardened against an adversarial review loop (7 passes). Several earlier framings were wrong: (a) calling AI-driven scraping a different *risk class* than scripted scraping (it's the same class, with different operational posture and explicit owner risk-acceptance), (b) treating a paste-flow form as a default solution without adoption evidence, (c) conflating Pages-API and Groups-API capability, (d) scoping lunar/seasonal RRULE work as "low risk" when the existing adapter has no timezone or observance model. The structure below reflects those corrections.

---

## Inventory: Where Facebook Shows Up Today

### A. Active STATIC_SCHEDULE sources with FB-URL labels (32, shipped)
*Counted as `enabled: true` source objects with at least one `facebook.com` reference in their config block (URL field, `defaultLocation`, or `defaultDescription`). A naive `grep -c facebook.com` will read higher because several sources mention the FB URL in more than one field; the source-object count is what matters for tiering.*

Examples: Rumson, NOSE H3, Mosquito H3, Wildcard, H6, PBH3, all 11 GA/SC fillers, PoofH3 MA, Little Rock (historic exception), Singapore Harriets (historic exception), JB-H3 Malaysia, HKFH3/FCH3-HK/Hebe-H3 Hong Kong. Full list: [`prisma/seed-data/sources.ts`](../prisma/seed-data/sources.ts).

These work, but they have known limitations the playbook already documents:
- Can't express **lunar recurrence** (Full Moon / New Moon hashes — KFMH3 Osaka uses Google Calendar instead because of this; many MY/HK FM kennels are unsupported).
- ~~Can't express seasonal schedule switching~~ — **resolved.** NOSE H3 (summer Thursday May–Oct / winter Wednesday Nov–Apr) ships correctly today as two seed sources with disjoint `BYMONTH` filters. The pattern was canonicalized in `source-onboarding-playbook.md` lesson #102 on 2026-04-30; see decision log entry 2026-04-30 below for why a single-source `seasons` schema was investigated and dropped.
- Don't know about **cancellations** (city event conflicts — see Charleston bridge-run example in [`facebook-user-research.md`](facebook-user-research.md) line 39).
- Don't carry **per-run details** (location, hares, on-after) — placeholder only.

### B. Profile-link kennels (149, shipped)
`Kennel.facebookUrl` populated, surfaced in `SocialLinks`. No data flow. Already correct as-is.

### C. FB-only kennels currently deferred (sample of 12 — NOT exhaustive)
This list is what surfaced in this session's research; it is **not** an audited inventory. See "Discovery gaps" below.
- **ASS H3** (Las Vegas) — lvh3.org dead 18mo; FB primary. [#734]
- **B2BH3** — closed deferred. [#656]
- **BCH3** — closed deferred. [#697]
- **Atlanta H4** — FB link died. [#635]
- **AUGH3** — FB source broken; falls back to STATIC_SCHEDULE. [#645]
- **CUNT H3** (London, monthly) — private FB group only. [`docs/kennel-research/london-hhh-research.md`](kennel-research/london-hhh-research.md)
- **Taco Tuesday H3 NJ** — group only. [`docs/kennel-research/us-deepen-nj-md-mi-la-research.md`](kennel-research/us-deepen-nj-md-mi-la-research.md)
- **Cherry Capital H3** (Traverse City) — seasonal FB-only.
- **Petoskey H3** (MI) — FB-only.
- **CoonASS H3** (LA), **Crescent Shiggy H3** (NOLA), **NOLA Full Moon H3** — website dead, FB only.
- **Winers H3** (Sonoma/Napa) — likely FB or email list only.

### Discovery gaps (explicit unknowns)
- **Malaysia Phase 2** — [`docs/kennel-research/malaysia-research.md`](kennel-research/malaysia-research.md) references ~150+ FB-only kennels not yet enumerated. Prisma seed has 7 MY kennels (Phase 1 only). True count and Page-vs-Group breakdown not audited.
- **Australia FB-only audit pending** — `hhh.asn.au` lists ~220 kennels; a subset is FB-only but no audit doc lists which.
- **GitHub `audit` label issues** — roadmap line 918 points at this label as the canonical list of FB-blocked kennels; this strategy doc should not assume the count is closed until that query is rerun and tabulated.
- **The above 12-kennel sample is a floor, not a ceiling.** Tiering decisions should be re-evaluated if discovery uncovers a categorically different distribution (e.g. "70% are private groups" would change the Tier 2 hypothesis).

### D. Discovery surface (separate problem)
The 16.6K-member HHH FB group is the #1 user-acquisition surface. "Is there a hash in [X]?" posts drive 20–72 comments. This is **not** an FB-ingestion problem — it's an SEO/Discovery problem already prioritized as P2 in [`roadmap.md`](roadmap.md) line 595. Out of scope for this strategy doc; flagged so we don't conflate "Facebook integration" with "users find us via Facebook."

---

## Use Cases We Want to Support

Derived from the inventory above. Each row is a real scenario we hit today.

| # | Use case | Concrete example | What we have | What's missing |
|---|---|---|---|---|
| **U1** | Recurring schedule, no per-run detail | Rumson Saturday | STATIC_SCHEDULE | Nothing — works |
| **U2** | Seasonal switch | NOSE Thursday-summer / Wednesday-winter | Two STATIC_SCHEDULE sources with disjoint `BYMONTH` (works correctly today) | Nothing — pattern canonicalized in source-onboarding-playbook.md #102 on 2026-04-30 |
| **U3** | Lunar recurrence | KFMH3 Full Moon, HKFH3, FCH3-HK, ~30+ MY full-moon kennels | Workaround via Google Calendar where the kennel maintains one | Lunar generator with timezone + ephemeris model |
| **U4** | Per-run location/hare/start-time | Little Rock posts day-of FB, Singapore Harriets, most MY kennels | Placeholder text only | Live FB read OR human submission |
| **U5** | Cancellations / conflicts | Charleston bridge-run cancellation | Nothing — we'd show a phantom event | Live FB read OR admin override |
| **U6** | Specials / campouts / anniversary | Red/Green Dress, hash-versary, weekend campouts | `special-events-prd.md` exists but no FB ingest | Live FB read OR admin/CSV submission |
| **U7** | Discover FB-only kennels | CUNT H3, Petoskey, ASS H3, Malaysian Phase 2 | Manual research per kennel | Some path to onboard without admin co-op |
| **U8** | Private FB groups | CUNT H3, Taco Tuesday NJ | Nothing | Only acknowledged path today is a group admin manually sharing content (O7). Any API-based path is **unresolved** pending audit T2d; do not treat O3-G as available. |

---

## Options Landscape (2026)

### Capability matrix — what each option actually unlocks

| Option | Pages (public) | Pages (private) | Groups (public) | Groups (private) | Real-time | One-shot | Notes |
|---|---|---|---|---|---|---|---|
| **O1. STATIC_SCHEDULE + RRULE expansion** | n/a | n/a | n/a | n/a | n/a | n/a | Source-of-truth is our own RRULE; FB URL is a label only |
| **O2. Graph API public read (no admin)** | ⚠️ App-Review-gated, scope-churn-prone | ❌ | ❌ | ❌ | ❌ | ❌ | `pages_read_engagement` for non-owned Pages has been narrowed multiple times since 2018 |
| **O3. Graph API admin OAuth (Pages)** | ❓ pending T2c | ❓ pending T2c | n/a | n/a | ❓ pending T2c | ❓ pending T2c | Requires App Review + per-kennel onboarding; Page admin must be willing. **No ✅ claims here until T2c confirms (a) the 2026 scope set, (b) App Review timeline/rejection rate, and (c) whether webhook payloads carry enough detail to build a RawEvent without follow-up Graph queries.** |
| **O3-G. Graph API admin OAuth (Groups)** | n/a | n/a | ❓ audit | ❓ audit | ❓ | ❓ | Meta deprecated third-party Groups API in April 2024 ([TechCrunch coverage](https://techcrunch.com/2024/02/05/meta-cuts-off-third-party-access-to-facebook-groups-leaving-developers-and-customers-in-disarray/)). **2026 status is unknown to this doc.** Whether a group admin can still install an app with any usable read scope must be answered by audit T2d before any capability is claimed here. |
| **O4. Headless-browser scraping (scripted)** | ⚠️ fragile, ToS-violating | ❌ | ⚠️ fragile | ❌ | ❌ | ⚠️ | FB anti-bot rated 5/5 in 2026; account/IP-ban exposure |
| **O5. Apify managed scraper** | ⚠️ ToS via vendor | ❌ | ⚠️ | ❌ | ❌ | ✅ | $0.013/event; viable only for one-time historical backfill |
| **O6. RSS bridges** | ⚠️ mostly broken | ❌ | ❌ | ❌ | ❌ | ❌ | Not viable in 2026 |
| **O7. AI-assisted human submission** (paste-a-FB-post or screenshot, Gemini extracts) | ✅ | ✅ via admin | ✅ | ✅ via admin | ❌ | ✅ | **Currently the only path this doc acknowledges for private Groups; revisit if T2d returns a usable O3-G route.** Requires sustained human effort per submission. |
| **O8. Email forwarding** (FB notifications → ingest@) | ⚠️ FB notif emails are thin | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | Untested; format brittle |
| **O9. Claude dispatch scheduled task visiting FB** (browser-render or Claude-in-Chrome, AI extracts) | ⚠️ active pilot | ❌ unless logged-in (see T2f) | ⚠️ active pilot | ❌ unless logged-in (see T2f) | ❌ | ⚠️ | **Active pilot under T2f — not deferred.** A single-page test is already in flight. Risk owner: project owner, accepting scraping-class ToS exposure for a low-volume / low-cadence pilot. Distinct from O4 in *operational posture*, not in *what FB's bot-detection sees*: Claude dispatch defaults to small N, slow cadence, manual extension, and tight observability — those are mitigations, not exemptions. |
| **O10. Crowdsourced public submission** | ✅ via user | ❌ | ✅ via user | ❌ | ❌ | ✅ | Requires moderation queue + abuse mitigation |

### Important capability honesty

- **O3 is primarily Pages.** The Groups path (O3-G) shrank dramatically in 2024. This doc makes **no claim** about 2026 Groups capability — the matrix above is a question, not an assertion. The strategy must not assume O3 reaches the private-group backlog (CUNT H3, Taco Tuesday NJ, much of MY) until audit T2d returns a documented answer with primary-source citations.
- **O9 sits in the scraping risk class but with explicit owner risk-acceptance.** From FB's perspective, automated traffic is automated traffic — the bot-detection signal does not care whether selectors come from a Playwright script or a Claude agent. The reason O9 is treated as an active pilot (and O4 / O5 / O6 are not) is that the project owner has explicitly accepted scraping-class ToS exposure for a low-volume, slow-cadence, observability-tight pilot, and there is already an empirical test in flight. The mitigations (small N, manual scaling, kill-switch, frequent owner inspection) are operational, not categorical. If the pilot's empirical behavior diverges from the assumptions — e.g. throttling, captchas, account flags — the kill-switch fires and O9 falls back into the deferred bucket.
- **The options fall into four risk classes, plus an owner-accepted exception for O9.** (i) **Our own data** — O1 (we author the RRULE; FB is a label). (ii) **Official Meta API access** — O2 (read-only without admin) and O3 (admin-installed). Review-gated and policy-churn-prone, but mechanically distinct from scraping. (iii) **Scraping** — O4, O5, O6 (deferred); **O9 sits in this class but is exempted from default deferral** by the owner-acceptance above. (iv) **Human-driven submission** — O7, O8, O10. The earlier "only O3 and O7 are non-scraping" framing was wrong because it implicitly classified **O2** (official read-only API access without admin install) as scraping; the four-class split above replaces it by giving official API access its own class regardless of admin scope. The O9 exception is recorded in the decision log so it cannot be lost in future review.

---

## Recommended Strategy

The honest read: **no single option covers all eight use cases**. Several options that look attractive in isolation are either ToS-exposed (O4, O5, O6, and — with owner-accepted risk — O9), capability-uncertain (O3, O3-G), or behavior-dependent in ways we have not validated (O7, O10). The right structure is to ship the parts that are unambiguously safe today, run small validated pilots for the next-most-promising paths (including the owner-accepted O9 scraping pilot), and explicitly defer everything else with a written decision record.

### Tier 1 — Ship now (zero new risk)

These are the only items that are simultaneously low-risk, immediately useful, and free of unvalidated assumptions.

- **The strategy doc itself (this file).** Future "why aren't we scraping FB" pushback gets routed here. Update [`roadmap.md`](roadmap.md) line 917 to point at this doc and reframe `FACEBOOK_EVENTS` as a deferred design until the T2f pilot graduates.
- **Cancellation override on STATIC_SCHEDULE-generated events** (U5). Admin marks a generated event as cancelled; the override sticks across re-scrapes. Reuses existing machinery in [`src/app/admin/events/actions.ts`](../src/app/admin/events/actions.ts). No new ingestion path; closes the most-cited correctness gap (Charleston-style conflicts) using human input we already have.
- ~~**Seasonal RRULE switch in STATIC_SCHEDULE** (U2)~~ — **dropped 2026-04-30.** Investigation showed NOSE H3 already ships seasonal switching correctly via two STATIC_SCHEDULE sources with disjoint `BYMONTH` filters (PR #1035 added `BYMONTH` parsing to the adapter); a single-source `seasons` schema would have duplicated month-partitioning semantics, rippled across the admin validator + `StaticScheduleConfigPanel` + seed helpers + `fetch()` validation, and added test surface for zero user-visible value. Codex's adversarial review surfaced these compatibility costs before code was written. The two-source-with-`BYMONTH` pattern is now the canonical seasonal-switch onboarding pattern (`source-onboarding-playbook.md` lesson #102). NOSE is the only validated seasonal-switch kennel in the repo today; future kennels with the same shape will use the same pattern. See decision log entry 2026-04-30 below.

Tier 1 explicitly does **not** include lunar recurrence. See Tier 2.

### Tier 2 — Pilot, with explicit gates

Each Tier 2 item is a hypothesis. None of them advances to default unless its gate fires.

**T2a. Lunar / observance-based recurrence in STATIC_SCHEDULE (U3) — SHIPPED via PR #1279 (2026-05-06).**

Originally promoted from "extend the adapter" to a design exercise because the adapter had no timezone or observance model. Shipped scope:
- Moon-phase dates computed locally via `suncalc` (MIT, ~10KB, no deps); no external API rate-limit risk.
- Anchor model supports both **exact phase-date** (FMH3-shape — event lands on the calendar date of the astronomical phase in the kennel's TZ) and **nearest-weekday** (DCFMH3-shape — `anchorWeekday` + `anchorRule: nearest | on-or-after | on-or-before`).
- Per-source IANA timezone projection from UTC phase instant to local kennel date.
- XOR validation across `rrule` and `lunar` config fields, enforced at admin form, server validator, and adapter runtime.
- `CalendarView` renders both full and new moon glyphs in the day-cell corner via the same `phaseDistance` metric used by the adapter (one-marker-per-cycle local-minimum check).
- `FREQ=LUNAR` ScheduleRule rows wired into `scripts/backfill-schedule-rules.ts` so Travel Mode projections beyond `scrapeDays` cover lunar kennels.
- Live-verified against FMH3 SF + DCFMH3 DMV.

**T2c (NEW). FACEBOOK_HOSTED_EVENTS adapter — SHIPPED via PR #1292 (2026-05-07).**

> **Correction note:** Earlier framings in this doc (and the O4 row of the capability matrix) implied that any URL-mode read against a public FB Page would hit the JS shell that profile/news-feed surfaces serve to logged-out clients. **Re-tested 2026-05-06 specifically against `https://www.facebook.com/{handle}/upcoming_hosted_events` and `/past_hosted_events` — those endpoints serve SSR'd inline GraphQL with full event tuples to a logged-out HTTP fetcher**, no headless browser, no proxy, no login wall. The earlier conclusion held for profile/news-feed surfaces; it did not hold for the dedicated hosted_events tabs. This PR ships the corrected adapter; O4 in the matrix is still accurate for non-hosted_events surfaces.

Shipped scope:
- New `FACEBOOK_HOSTED_EVENTS` SourceType with adapter + parser at `src/adapters/facebook-hosted-events/`.
- Parser walks `<script type="application/json">` islands; FB splits each event across two related nodes (rich `__typename:Event` + time-only) sharing the same `id` — adapter buckets by id and per-field/per-axis merges (Codex passes 1–4 fixed naive overwrites that lost lat/lng).
- Detail-page enrichment: each event's `/events/{id}/` is fetched sequentially with 200ms courtesy delays (cap 30 events/scrape) so the canonical Event ships with the post-body description (hares, shiggy level, parking, after-after) instead of just structured fields. Per-event failures bounded-sample into `diagnosticContext.detailFetchErrorSample`.
- `upcomingOnly: true` is a structural invariant enforced at three layers (TS literal type, admin validator, adapter runtime) — without it the reconciler would interpret missing past events as cancellations.
- 35-namespace reserved-prefix rejection (`events`, `groups`, `profile.php`, etc.) so a pasted event URL never gets saved as a `pageHandle`.
- Required headers empirically pinned: browser User-Agent + `Sec-Fetch-Dest: document` + `Sec-Fetch-Mode: navigate` + `Sec-Fetch-Site: none`. Missing the Sec-Fetch triplet returns HTTP 400.
- Trust level 8; canary kennel is **GSH3** (Grand Strand H3, Myrtle Beach SC). The existing STATIC_SCHEDULE source for GSH3 is kept at low trust as a fallback so cron resilience is preserved.
- Cancellation interaction with PR #1185 admin override is automatic — `is_canceled: true` events are dropped at ingest; the existing `merge.isAdminLocked` guard prevents an FB un-cancel from flipping a deliberately-locked admin cancellation.
- Future-add data points (cover image, RSVP counts, end time, online-flag, structured venue address) catalogued in [`event-schema-future-fields.md`](event-schema-future-fields.md) so the next person adding a FB-derived field has a verified extraction path.

The doc's **existing T2c entry below (Graph API admin OAuth — Pages capability check)** is unrelated and still pending. Two different Tier 2 items happened to share a label across the strategy doc and the implementation plan; readers should treat the section labelled "T2c. Graph API admin OAuth — Pages" below as the doc's authoritative T2c.

**T2a (legacy framing, kept for reference) — Gate to ship was a design doc covering moon-phase data source, observance rules, per-source IANA timezone, and US/HK/MY correctness tests.** All four bullets satisfied in PR #1279.

**T2b. Paste-a-FB-post submission flow (O7).**
Reframed from default Tier 1 to a validated pilot because there is **no evidence** kennel admins will sustainably paste posts. The earlier "10s/run" claim was unsupported. Pilot scope:
- Build the form behind a feature flag, scoped to a hand-picked set of 5 cooperating kennels (recruit before building, not after).
- Define the adoption gate **before** launch:
  - ≥3 of 5 kennels submit ≥1 post/week for 60 days.
  - ≥50% of submitted events resolve cleanly to RawEvent (Gemini extract + admin confirm) without adapter-side fallback.
- If gate fails, the form is removed (not left as an unmaintained orphan).
- If gate passes, promote O7 to default for U4/U5/U6 with a public-facing version (O10-style) considered separately.

**T2c. Graph API admin OAuth — Pages capability check (O3 Pages-only).**
Before considering O3 a real path, run a one-week capability audit:
- Confirm 2026 scope set required to read events from a Page where our app is admin-installed.
- Confirm current App Review timeline and rejection rate via Meta dev forums.
- Confirm whether webhooks for `feed`/`events` deliver enough detail to build a RawEvent or whether each notification still requires a follow-up Graph query.
- Output: a one-page capability note appended to this strategy doc.

Decision criterion (replaces the earlier arbitrary "20-kennel" gate): pursue O3 Pages when **either** (a) we have ≥3 kennel admins willing to be App Review test users and a feature roadmap item that depends on real-time Page reads, **or** (b) the prerequisite **frozen-inventory audit** (see T2e below) shows that Tier 1 + T2b together cannot reach ≥80% of the audited Page-only backlog. The 80% gate is meaningless without a counted denominator, so it does not fire until T2e produces one. **Denominator rule (summary, canonical definition lives in T2e):** the denominator is the count of T2e rows with `surface = page`; `surface = unknown` rows are excluded until reclassified. This summary is reproduced here so the gate is not discretionary at evaluation time, but if the rule needs to change, edit T2e and only update this summary to match — T2e is the source of truth.

**T2d. Graph API admin OAuth — Groups capability check (O3-G).**
Separate audit. Pre-requisite for any plan that claims to reach private Groups via API. Output: a yes/no on whether the 2024 Groups deprecation left a usable admin-installed path in 2026, with primary-source Meta citations (developer docs, changelog, or scope reference). If the answer is no, the matrix's O3-G row is closed and removed.

**T2f. Claude dispatch FB-page pilot (O9) — already in flight.**
Owner: project owner (johnrobertclem@gmail.com), with explicit acceptance of scraping-class ToS risk for the duration of this pilot. This is **not** Tier 3 deferred and **not** gated on a memo from someone else; the owner-acceptance is recorded in the decision log below.

**Empirical anchor.** A single Claude dispatch scheduled task already runs against one public FB Page on a slow cadence. Before this strategy doc moves the pilot from N=1 to N=5, the owner appends a "current-state" sub-section to the doc capturing:
- Which Page (URL).
- Cadence (e.g. once daily).
- What's extracted on each run (event posts? all posts? schedule-only?).
- Where output lands (proposal queue, RawEvent, log file, manual review).
- Run-history observations to date (any throttling, captcha, account flags, selector drift, blank pages).
- The dispatch entry-point (skill / scheduled task ID / scheduled-tasks MCP record).

**Pilot scope (initial — owner-approved 2026-04-29).**
- **Public FB Pages only at the N=1→N=5 expansion.** Logged-in session targeting private Groups is a **separate explicit decision**, not a default extension. Re-asking that decision is gated on having empirical signal from the public-only run. Until that decision flips, the pilot does not authenticate to FB.
- **Log-file output only during the pilot — no database writes.** Extracted events go to a structured log file Claude dispatch produces (one entry per run, one block per Page). Nothing merges into RawEvent, ProposalEvent, or any HashTracks-side table during the pilot. The pilot is purely an extraction-quality and breakage-rate experiment; user-facing data cannot be corrupted by a bad scrape day because there is no write path. Designing the write path (proposal queue vs trust-level RawEvent vs other) is a follow-up decision that fires only if the pilot survives its kill-switch.
- Cadence ≤ once per Page per day. No retries on failure (a fail returns an empty log entry; we don't pile up requests).
- N starts at 1 (current state); next expansion increment is N=5 with the same cadence; N=10 thereafter only if the N=5 run is clean. No silent N growth.
- Each run logs: HTTP status, page-load timing, presence/absence of expected DOM markers, count of extracted events, raw HTML hash, and the extracted events themselves. Logs are inspectable by the owner per run.

**Kill-switch.** O9 returns to deferred (and the dispatch task is paused) on **any** of:
- A captcha / interstitial / "we noticed unusual activity" page on any run.
- An IP ban or 403/429 burst on the NAS or Claude-in-Chrome traffic origin.
- A logged-in session (if added later) being challenged for re-auth more than once in 30 days.
- A Meta cease-and-desist or formal takedown request.
- The owner observing extraction quality below 80% (events found vs events on the live Page) for 2 consecutive runs.

The kill-switch decision is owned by the project owner; no committee. When fired, the dispatch task pauses, an entry is appended to the decision log, and the matrix's O9 row reverts to ❌ until the owner re-enables.

**Promotion gate.** O9 graduates from log-only pilot to a first-class adapter (`FACEBOOK_EVENTS` per [`roadmap.md`](roadmap.md) line 917) only when **all** of:
- 60 consecutive days of N≥5 public-Page runs without the kill-switch firing.
- ≥80% extraction quality sustained over the 60 days, measured by spot-checks against the live Pages.
- A separate explicit decision has been made on (a) logged-in scope (in or out) and (b) write path (proposal queue vs low-trust RawEvent vs other). Promotion does not implicitly grant either.
- A written runbook for routine re-auth / selector drift / breakage exists.
- A capability comparison vs T2c (Graph API admin OAuth) shows O9 still wins on something concrete (coverage, latency, kennel adoption friction). If T2c lands first and beats O9, O9 stays a fallback for kennels that won't admin-OAuth — not the default path.

**T2e. Frozen FB-only backlog audit.**
Prerequisite for any percentage-based gate elsewhere in this doc (specifically the O3 Pages decision criterion in T2c). The output must be reproducible — two auditors running the same procedure should land on the same counted denominator.

**Inclusion criteria.** A kennel is in the FB-only backlog if and only if all of:
- The kennel exists in [`prisma/seed-data/kennels.ts`](../prisma/seed-data/kennels.ts) OR is named with intent-to-add in any `docs/kennel-research/*.md`.
- Its only known schedule-bearing source is a Facebook URL (Page or Group). "Schedule-bearing" excludes contact-only `facebookUrl` profile fields where another source (calendar, sheet, scraper, Harrier Central, etc.) already feeds the kennel.
- The kennel is **active**, defined operationally as one of:
  - **A.** A `Kennel` row exists in `prisma/seed-data/kennels.ts` at the commit SHA frozen at audit start (SHA recorded in snapshot file frontmatter) AND the corresponding production `Kennel.lastEventDate` (per [`prisma/schema.prisma`](../prisma/schema.prisma)) is within the past 365 days at audit-start timestamp.
  - **B.** No seed row yet, but at least one post on the FB URL within the past 12 months, with admissible evidence: (i) a logged-out screenshot/timestamp for public Pages or public Groups, or (ii) a kennel-admin-confirmed report (email or HashTracks-side message) for private Groups the auditor cannot access.
  - Kennels matching neither A nor B are classified `activity=unknown` and **excluded** from the denominator. They appear in the excluded-item log with a reason. They do not silently inflate or deflate the count.
  - Note: this doc does **not** invent a new schema field. If `Kennel.lastEventDate` semantics ever change, this rule must be re-frozen.

**Classification.** Each included kennel gets a row with: `kennelCode`, `region`, `fbUrl`, `surface ∈ {page, group, unknown}`, `visibility ∈ {public, private, unknown}`, `source-of-record path` (one of `kennel-research/<file>`, `seed`, `gh-issue:<n>`). `unknown` is a single, allowed enum value for both axes — never coerced silently and never substituted by an auditor's guess. Rows with any `unknown` axis still appear in the audited table in their own "unknown classification" sub-section.

**Mandatory rule for unknown rows in percentage gates (canonical).** The T2c 80% O3-Pages gate uses a denominator of **rows with `surface = page` only**. Rows with `surface = unknown` are **excluded from the denominator** until reclassified, and never silently rolled into the page count. T2c reproduces this rule as a summary at the gate text so the decision is not discretionary at evaluation time; this section is the source of truth — edits start here.

**Dedupe key.** `kennelCode` if present, otherwise normalized FB URL (lowercase, strip query, strip trailing slash). Mixed Page/Group cases (a kennel with both) count as one kennel and record the schedule-bearing surface.

**Required artifacts.** A versioned snapshot file `docs/facebook-backlog-<YYYY>-<MM>.md` containing **everything needed to reproduce the denominator without consulting live production state or private channels later**:
- The row-level table.
- The excluded-item log with reasons.
- For every row classified active by criterion A: the **frozen `lastEventDate` value** at audit-start, materialized into the snapshot table itself (not implicit in a "live query at audit start" reference). Production state can drift; the snapshot must not.
- For every row classified active by criterion B, preserved admissible evidence covering whichever branch was used:
  - **B(i) public-surface branch** — a stored screenshot file (path under `docs/facebook-backlog-evidence/<audit-tag>/<row-id>/`) capturing the post and its visible timestamp, plus the URL fetched.
  - **B(ii) private-surface branch** — a copy or durable reference (internal HashTracks audit-evidence record ID, or a stored email/message export under the same evidence path) of the kennel-admin confirmation.
  - Evidence that is not preserved in the audit artifact is **inadmissible**, regardless of which branch.
- The `gh issue list --label audit --search "facebook" --state all` raw output as of the audit date.
- The script or prompt used to produce the table.
- The audit-start commit SHA (for seed) and audit-start timestamp (for `lastEventDate` materialization).

A second auditor should be able to verify the denominator from the artifact alone, without re-querying production or re-soliciting private evidence.

**Inputs to traverse.**
- All `docs/kennel-research/*.md` files cross-referenced against `prisma/seed-data/sources.ts` and `prisma/seed-data/kennels.ts`.
- `gh issue list --label audit --search "facebook" --state all`.
- Malaysia Phase 2 enumeration (currently named but uncounted in [`docs/kennel-research/malaysia-research.md`](kennel-research/malaysia-research.md)).
- Australia FB-only audit against `hhh.asn.au`.

Until this snapshot exists, no percentage-based decision in this doc can fire.

### Tier 3 — Out of scope this cycle

- **O4 — scripted/custom FB scraping (NAS Playwright with persistent session, no AI driver).** Out of scope. The owner-acceptance for O9 does **not** transfer to O4: scripted scraping is higher-volume by default, harder to keep slow and observable, and produces selector-maintenance debt the O9 pilot avoids. If the O9 pilot fails its kill-switch, O4 remains deferred — falling back to O4 is not the default escape hatch.
- **O5 — Apify ongoing.** Same fundamental ToS posture as O4/O9, but with a vendor running the scraper at a cadence we don't control. Acceptable for a one-shot historical backfill PR; not for daily ingestion.
- **O6, O8, O10.** Noted as future possibilities with no current owner.
- **The Discovery surface problem** (P2 SEO/finder). Tracked elsewhere; not this doc.

---

## Decision Log

This section is intentionally append-only. **New entries on top.**

**2026-05-07 — T2a Lunar (PR #1279) and FACEBOOK_HOSTED_EVENTS adapter (PR #1292) shipped; URL-mode framing corrected**

Two Tier 2 items merged this week:

1. **T2a (Lunar STATIC_SCHEDULE) — PR #1279.** Ships exact-phase + nearest-weekday anchor models, IANA-TZ-aware projection, three-layer XOR validation across `rrule` and `lunar`, and CalendarView moon-phase glyphs. Full design intent in the original T2a Tier 2 entry above is satisfied; entry is now annotated SHIPPED.

2. **FACEBOOK_HOSTED_EVENTS adapter (plan-T2c, NEW item) — PR #1292.** Net-new Tier 2 item that did not exist in this doc when it was first written. Discovered by re-testing the URL-mode assumption against `https://www.facebook.com/{handle}/upcoming_hosted_events` on 2026-05-06: that endpoint serves SSR'd inline GraphQL with full event tuples to a logged-out HTTP fetcher, contradicting the doc's earlier assumption (which was actually only true for profile/news-feed surfaces). The capability-matrix O4 row remains accurate for those non-hosted_events surfaces; the new adapter is its own narrow option, not a replacement for O4.

   Mechanics shipped: dual-node parser (Codex-validated through 5 review passes), detail-page enrichment so descriptions reach the canonical Event, three-layer `upcomingOnly: true` invariant, 35-namespace reserved-prefix list, future-fields catalog at [`event-schema-future-fields.md`](event-schema-future-fields.md). Canary kennel: GSH3 (Grand Strand H3, Myrtle Beach SC) with the existing STATIC_SCHEDULE source kept as low-trust fallback for cron resilience.

   **Naming note:** the implementation plan labeled this work "T2c (NEW)" because it was a new Tier 2 item; the strategy doc's existing T2c entry is the unrelated Graph API admin-OAuth Pages capability audit. Both labels coexist intentionally — the doc's T2c is still an open audit, this entry tracks a different shipped capability.

**2026-04-30 — Seasonal RRULE feature dropped from Tier 1**

When work began on the Tier 1 "Seasonal RRULE switch in STATIC_SCHEDULE" item, exploration revealed:
- NOSE H3 (the example named in the original Tier 1 entry) already ships seasonal switching correctly via two `STATIC_SCHEDULE` sources sharing one `kennelTag`, each scoped via disjoint `BYMONTH` filters (May–Oct Thursday / Nov–Apr Wednesday). PR #1035 added `BYMONTH` parsing to the `parseRRule()` helper before this strategy doc was written; the original "NOSE is brittle" framing was inaccurate.
- The proposed single-source `seasons: SeasonRule[]` schema was put through Codex adversarial review pre-code. Findings: (a) `months[]` duplicates `BYMONTH`'s existing month-partitioning semantics — a config can silently disagree with itself; (b) making top-level `rrule` optional ripples into the admin validator, the `StaticScheduleConfigPanel` UI, the shared seed helper, and `fetch()` validation — far beyond a "config-shape change"; (c) NOSE migration in the same PR creates manual prod-cleanup debt; (d) the proposed "annual parity" test is weaker than the actual fetch contract (window-dependent, anchor-aligned).
- The user-visible value was zero (NOSE works today). The cost was a multi-layer schema change with non-trivial validation and window-boundary tests.

**Decision:** drop the feature. Document the BYMONTH-on-multiple-sources pattern as canonical (`source-onboarding-playbook.md` lesson #102 + step-6 example). Update Tier 1 in this doc to reflect the corrected scope. Move to the cancellation override item (the Tier 1 entry with actual user value — phantom-event correctness gap).

If a future, validated seasonal-switch onboarding case materially benefits from a single-source seasons schema (i.e. the two-source-with-`BYMONTH` pattern produces real friction beyond DRY-only), this decision can be revisited with the corrected understanding of the cost surface. The earlier draft of this entry named LBH3 and Cherry Capital as motivating cases; that was inaccurate — LBH3 already has a `GOOGLE_CALENDAR` source covering its schedule, and Cherry Capital's schedule is unverified (FB-only with unclear regularity per `docs/kennel-research/us-deepen-nj-md-mi-la-research.md`). Reopening the question requires a real validated case, not a speculative one.

**2026-04-29 — Initial decisions**

1. **O9 (Claude dispatch FB-page scraping) is an active pilot, not deferred.** The project owner explicitly accepts scraping-class ToS risk for a low-volume / slow-cadence / kill-switch-armed pilot. This acceptance does **not** transfer to O4 (scripted scraping) or O5 (Apify ongoing); those remain deferred. The acceptance is revoked automatically by any kill-switch trigger listed in T2f and may be revoked at any time by the owner; revocation appends a new decision-log entry.
2. **Tier 1 is intentionally small** (strategy doc, cancellation override, date-range seasonal RRULE). Lunar recurrence, paste-flow, capability audits, and the Claude dispatch pilot are all Tier 2 with explicit gates — not Tier 1 ship-now.
3. **O3 is two separate questions** (Pages vs Groups) and must be answered with capability audits, not assumed. The earlier "20-kennel threshold" was arbitrary and is replaced with concrete decision criteria above.
4. **The deferred-FB-only inventory in this doc is a sample, not a census.** Tiering may need to be revisited once the discovery gaps (MY Phase 2, AU audit, GitHub `audit` label) are closed.
5. **Codex adversarial-review loop ran 7 passes** on the planning version of this doc; the final pass approved. Codex's framing that O9 belonged in the same deferred bucket as O4 was overridden by owner directive — entry 1 above is the explicit override Codex's review demanded.

---

## Verification (Acceptance Criteria for This Doc)

- [x] `docs/facebook-integration-strategy.md` exists and contains the inventory, capability matrix, tiering, and decision log.
- [x] The "Discovery gaps" section names at least three open audits (MY Phase 2, AU, GitHub `audit` label) with a way to resolve each.
- [x] The capability matrix distinguishes O3 (Pages) from O3-G (Groups). The O3-G row cites the 2024 Groups API deprecation (TechCrunch link) AND explicitly states that 2026 capability remains unresolved pending audit T2d. Without asserting any present-tense 2026 capability.
- [x] O9 sits in the scraping risk class but is exempted from default deferral via owner risk-acceptance recorded in the decision log; O4 is deferred and O9-acceptance does not transfer to it.
- [x] T2b adoption gate is written as a numeric criterion (kennels, posts/week, days) before any form code is built.
- [x] T2a is gated on a lunar design doc that names a moon-phase data source and a timezone model.
- [x] T2e frozen-inventory snapshot is explicitly listed as a blocking prerequisite for the **O3 Pages percentage-based decision criterion in T2c** (not for T2c-the-capability-audit).
- [x] The O3-G row in the capability matrix contains zero asserted 2026 capability claims; it is framed only as an audit question pending T2d.
- [x] The strategy doc references the GitHub issue set named in this plan's inventory section verbatim — #635 (Atlanta H4), #645 (AUGH3), #656 (B2BH3), #697 (BCH3), #734 (ASS H3 / Las Vegas).
- [x] [`roadmap.md`](roadmap.md) line 917 is updated and points at this strategy doc.
- [x] The decision log section exists with the five 2026-04-29 entries above and instructions to append future entries on top.
- [x] No new code changes in this PR (strategy doc only).
