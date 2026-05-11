# FACEBOOK_PUBLIC_GROUP Adapter Feasibility Spike

> **Status:** complete, verdict **C — NO-GO (defer indefinitely; reframe via O7 paste-flow per existing strategy doc).**
> **Date:** 2026-05-11.
> **Author:** Claude (research spike, no shipping code).
> **Scope:** Resolve cycle-5 unknowns blocking the original Deep-Dive workstream proposal for a `FACEBOOK_PUBLIC_GROUP` adapter parallel to the shipped `FACEBOOK_HOSTED_EVENTS` (PR [#1292](https://github.com/johnrclem/hashtracks-web/pull/1292)).
> **Inputs:** [#1360](https://github.com/johnrclem/hashtracks-web/issues/1360), [#1358](https://github.com/johnrclem/hashtracks-web/issues/1358), [#1373](https://github.com/johnrclem/hashtracks-web/issues/1373), [#1374](https://github.com/johnrclem/hashtracks-web/issues/1374), [`docs/facebook-integration-strategy.md`](../facebook-integration-strategy.md), [`docs/kennel-research/facebook-hosted-events-audit.md`](./facebook-hosted-events-audit.md).
> **Deliverables:** this doc + 3 sanitized JSON-island fixtures under [`docs/kennel-research/facebook-public-group-fixtures/`](./facebook-public-group-fixtures/).

## TL;DR

Building a logged-out HTTP-fetch scraper for public Facebook **Groups** is **mechanically possible but economically pointless** in our specific kennel-onboarding setting. Three independent failure modes compound:

1. **Hash kennel Groups overwhelmingly trend private.** Across 22 hash-kennel Groups probed (broad sample: US, UK, HK, JP, NL, EU, AU, SE Asia), **1 was genuinely public**, 17 returned a "Private group" SSR landing page with metadata only, and 4 returned a generic login-wall interstitial. That's ~5% public. Cycle-4's audit found the same shape from the other direction: 106 of 159 seeded `facebookUrl` values are `/groups/...` URLs and were all skipped by `FACEBOOK_HOSTED_EVENTS` for the same reason.
2. **The one public Group does not use FB Events.** Hebe H3 (`groups/HebeH3`, 225 members, confirmed public) maintains its `/events` tab with **stale entries from January 2024** — over 16 months old at audit time — while the kennel publishes 2025 run announcements in discussion-feed posts. Per [#1360](https://github.com/johnrclem/hashtracks-web/issues/1360), the relevant run-detail content lives in posts, not events.
3. **Logged-out discussion feeds render only pinned/featured posts, not the live stream.** From a 1.1 MB SSR response (89 JSON islands) for Hebe H3's main page, only **2 unique post bodies** were extractable, both stale 2024 content. The recent posts referenced in #1360 (Apr 2025 onward) are not server-rendered to an anonymous client.

The cycle-4 `FACEBOOK_HOSTED_EVENTS` adapter ships because Pages serve a dedicated `/upcoming_hosted_events` tab with inline GraphQL containing full event tuples. Groups do not have a parallel surface that exposes upcoming-event detail to logged-out fetchers.

**Recommendation:** Maintain the existing strategy doc's path. The FB-group-only kennel backlog (Hebe H3, Circus H3, BFM, NOH3, etc. — see audit table) is addressed by **T2b "paste-a-FB-post" (option O7)** in [`facebook-integration-strategy.md`](../facebook-integration-strategy.md), gated on adoption evidence. Build no `FACEBOOK_PUBLIC_GROUP` adapter, add no new `SourceType`. The verdict-C rationale below is the audit trail that should keep this from being re-proposed in cycle-N.

## 1. Fetchability

### Method

Logged-out HTTP GET with the exact header bundle the shipped `FACEBOOK_HOSTED_EVENTS` adapter uses ([`src/adapters/facebook-hosted-events/adapter.ts:44-52`](../../src/adapters/facebook-hosted-events/adapter.ts:44)): pinned browser User-Agent + `Sec-Fetch-*` triplet + browser Accept headers, no cookies. `curl` from a normal residential workstation (no proxy, no headless browser).

### Results — 22 hash-kennel Group URLs probed (2026-05-11)

| Status | Count | Diagnostic SSR signature |
|---|---:|---|
| **PUBLIC** | 1 | 3× "Public group" string, og:title populated, ≥3 post `message.text` bodies in JSON islands, /events tab returns 3× `__typename:"Event"` nodes |
| **PRIVATE** | 17 | 1× "Private group" string, og:title populated with real kennel name, **0** post bodies, **0** Event __typename nodes, 1× `start_timestamp` (FB's "next event" widget header) |
| **LOGIN-WALL** | 4 | Generic `<title>Facebook</title>`, no og:title, no public/private marker, smaller (~328 KB) SSR bundle |

| Group | Slug | Verdict | Bytes | islands | Notes |
|---|---|---|---:|---:|---|
| Hebe H3 | `HebeH3` | **PUBLIC** | 1,095,016 | 89 | 3× post body, 2× ts, /events has 3 Event nodes |
| BFM | `bfmh3` | private | 437,489 | 64 | "Private group · 1.4K members" |
| Amsterdam H3 | `AmsterdamH3` | private | 435,210 | 64 | |
| BJH3 (Beijing) | `bjhash` | private | 431,220 | 64 | |
| BTH3 (Bangkok) | `bangkokthursdayhash` | private | 429,046 | 64 | |
| Circus H3 | `circushash` | private | 432,917 | 64 | Cited in [#1180](https://github.com/johnrclem/hashtracks-web/issues/1180); private confirms strategy doc U7 framing |
| Colombian H3 | `columbianh3` | private | 434,766 | 64 | |
| DCH4 | `dch4hashhouse` | private | 439,133 | 64 | |
| East Bay H3 | `Ebhhh` | private | 428,090 | 59 | |
| JaxH3 | `JaxH3` | private | 434,941 | 64 | |
| Kyoto H3 | `kyoh3` | private | 433,996 | 64 | |
| NOH3 | `NewOrleansHash` | private | 435,547 | 64 | |
| NOSE Hash | `NOSEHash` | private | 431,249 | 64 | |
| Osaka H3 | `550003685094291` | private | 438,390 | 64 | |
| Surf City H3 | `SurfCityH3` | private | 437,019 | 64 | |
| Tokyo H3 | `896005733756352` | private | 435,691 | 64 | |
| ASS H3 (Las Vegas) | `ASSH3` | private | 439,051 | 64 | Referenced in strategy doc inventory |
| Sav H3 | `savh3` / `SavH3` | login-wall | 328,121 | 38 | Generic title, both casings tried |
| NYC H3 | `nychash` | login-wall | 328,203 | 38 | Generic title |
| Austin H3 | `AustinH3` | login-wall | 443,153 | 53 | Generic title |
| Mosquito H3 | `MosquitoH3` | login-wall | 443,055 | 53 | Generic title |

**No CAPTCHA, no 4xx, no IP throttle observed** across the 22 probes (sequential, ~1s apart). Set-cookie payloads are FB tracking only; no auth tokens. So **fetchability itself is not the blocker** — the SSR is served. The blocker is that the served payload doesn't contain usable event data for ~95% of targets.

### Hard-gate evaluation

The plan's hard-gate criterion ("< 200 / auth wall consistently → NO-GO") technically does **not** fire — fetches succeed with HTTP 200. But the operational effect (1 in 22 yields a public group + that one yields stale data) is functionally equivalent. The verdict is NO-GO on **addressable-surface** grounds, not on fetchability grounds. Documenting this distinction so future readers understand why a "200 OK" doesn't translate to "viable adapter."

## 2. Payload shape

Three surfaces analyzed end-to-end. Comparison table follows.

### Surface comparison

| Property | FB Page `/upcoming_hosted_events` (cycle-4, shipped) | FB Group `/events` (this spike) | FB Group main feed (this spike) |
|---|---|---|---|
| Logged-out fetch success | ✅ HTTP 200 | ✅ HTTP 200 (public groups only) | ✅ HTTP 200 (public groups only) |
| JSON islands present | ✅ ~60–90 | ✅ 62 (Hebe H3) | ✅ 89 (Hebe H3) |
| SSR envelope markers (`RelayPrefetchedStreamCache`, `__bbox`) | ✅ both | ✅ both | ✅ both |
| `__typename:"Event"` rich nodes inline | ✅ N events per page | ✅ 3 nodes (Hebe H3) — but **all `is_past:true`** | ❌ 0 |
| Inline time node with `start_timestamp` | ✅ separate node, merged by event-id | ❌ **not present** | ❌ not present |
| Inline `event_place` with coords | ✅ (typically) | ❌ **not present** | ❌ not present |
| Listing covers upcoming events only | ✅ (that's the tab's purpose) | ❌ tab is unmaintained on the only public group | n/a |
| Discussion-feed `message.text` post bodies | n/a (Pages don't expose posts on this tab) | n/a | ⚠️ only 2 stale pinned posts surfaced from 1.1 MB SSR; live feed needs auth |
| Detail-page enrichment (`/events/<id>/`) recovers `start_timestamp` + `event_place` | ✅ (this is the adapter's enrichment loop) | ✅ (verified — same shape as Page detail pages) | n/a |
| Parser-reuse % vs cycle-4 | 100% | ~70% (would need detail-fetch-only path; no listing-level time merge) | ~10% (entirely different shape; would be a post-body NLP parser) |

### Key concrete evidence (from sanitized fixture)

The three Event nodes in `hebe-h3-events.json.fixture` show this clearly. Every node has:

```jsonc
{
  "__typename": "Event",
  "name": "Hebe Hash #51",
  "url": "https://www.facebook.com/events/EVENT_ID_REDACTED/",
  "is_canceled": false,
  "is_past": true,              // ← all 3 are past
  "event_kind": "PUBLIC_TYPE",
  "day_time_sentence": "Saturday, January 20, 2024"  // ← human-readable only
  // NO start_timestamp
  // NO event_place
}
```

The `day_time_sentence` could in principle be parsed with chrono-node (we already have `chronoParseDate` per `.claude/rules/adapter-patterns.md`), but the precondition — the kennel actually maintaining FB Events — is not met for the one public group we have. So this would be parsing well-formed strings about events that are 16+ months stale.

### Detail-page enrichment (one positive note)

A fetch of `https://www.facebook.com/events/<id>/` for any of the 3 listed events **does** return a full SSR with 12× `start_timestamp` and 8× `event_place` mentions (verified against event id 708093537757591 → 2024-01-20T02:00 UTC, place "Kotong Village Saikung"). So *if* a public group maintained its `/events` tab with current entries, the technique would work: scrape the listing for event ids + names, fetch each detail page with the existing per-event detail-fetch loop (cap 30 events, 200ms courtesy delay) — the cycle-4 adapter's detail-fetch infrastructure transplants cleanly.

This positive finding doesn't change the verdict, because the precondition (kennel maintains the /events tab) doesn't hold for the one public-group sample.

### Fixture sanitization

Raw responses (3 files totaling ~2.4 MB) saved locally at `/tmp/fb-spike/*.html`. Per the spike plan, raw HTML is **NOT committed** — it carries the full FB UI shell with analytics, ad iframes, and a long tail of user-tracking IDs in scopes we don't need to keep around.

**What lands in the repo:** sanitized JSON-island extracts at `docs/kennel-research/facebook-public-group-fixtures/`. Three fixtures (totaling ~49 KB):

| Fixture | Size | Purpose |
|---|---:|---|
| `hebe-h3-events.json.fixture` | 43,715 B | The /events tab JSON islands containing the 3 `__typename:"Event"` nodes. Demonstrates the structural difference vs cycle-4 Page parser (no inline timestamp, no event_place). |
| `hebe-h3-main-feed.json.fixture` | 3,795 B | The 2 post-body samples that did surface in the SSR main feed. Demonstrates the "logged-out SSR only renders pinned/featured" problem. |
| `bfm-private-group-comparison.json.fixture` | 1,369 B | Header summary of what a typical private hash group SSR looks like (1× "Private group" marker, 0× message body, 0× Event __typename). Useful evidence for future audits classifying group visibility from a logged-out probe. |

**Sanitization rules applied** (in code at the build step, not in a separate review pass):
- `__typename: User | CometProfile | GroupMember` → `name` replaced with `USER_<letter>`; `short_name` → `USER_SHORT`; `contextual_name` → `USER_CTX`
- Any 10–20-digit numeric string under id-shaped keys (`id`, `actor_id`, `creator_id`, `shared_in_group_by_id`) → `PROFILE_ID_<###>`
- Photo URLs containing `fbcdn` or `scontent` → `https://example.com/photo-<n>.jpg`
- `eventUrl` / `url` containing `/events/<numeric>/` → `/events/EVENT_ID_REDACTED/`
- `/permalink/<numeric>/` → `/permalink/PERMALINK_REDACTED/`

**What is intentionally NOT redacted:**
- **Hash names in post-body text** (e.g. "Hopeless", "Smallbone", "Lost in Translation"). These are public hashing-community identities, already present in our `Kennel.hares` data, and are the exact signal a discussion-feed parser would key on. Sanitizing them out would defeat the fixture's parser-design value. The plan's sanitization rule specifies "real user names" — the H3 convention is that hash names are intentionally pseudonymous, not the hasher's legal identity. We're following the spirit of the rule.
- **The kennel's group slug** (`HebeH3`) and **group name** (`Hebe Hash House Harriers`) — already public per the kennel page in seed (and per the cited issue).

## 3. ToS / policy posture

Per Meta's current Terms of Service (Section 3.2, "What you can share and do on Meta Products"):

> "You may not access or collect data from our Products using automated means (without our prior permission) or attempt to access data you do not have permission to access, regardless of whether such automated access or collection is undertaken while logged-in to a Facebook account."

**The ToS makes no distinction between Pages and Groups.** Public-Page scraping and public-Group scraping sit under the identical clause. Cycle-4's `FACEBOOK_HOSTED_EVENTS` adapter ships under the **owner-acceptance** of scraping-class ToS exposure recorded in [`facebook-integration-strategy.md` decision log entry 2026-04-29](../facebook-integration-strategy.md) (item 1: "scraping-class ToS risk for a low-volume / slow-cadence / kill-switch-armed pilot"). That acceptance was granted specifically for Pages because cycle-4 had concrete evidence the surface was useful; nothing in the language singles out Pages.

If the addressable-surface verdict were positive, a `FACEBOOK_PUBLIC_GROUP` adapter would inherit the same owner-acceptance regime by parity (logged-out, low-volume, kill-switch armed). **ToS posture is NOT a gating factor for this verdict.** The reason for NO-GO is item 2 (no useful data on the surface), not policy.

## 4. Admin-surface footprint

If the verdict were GO, the implementation footprint (per the spike's surface-count subtask) would be:

| File | Edit shape | LOC est. |
|---|---|---:|
| [`prisma/schema.prisma`](../../prisma/schema.prisma) | Add `FACEBOOK_PUBLIC_GROUP` to `AdapterType` enum | +1 |
| [`src/adapters/registry.ts`](../../src/adapters/registry.ts) | Import + factory switch case | +3–5 |
| `src/adapters/facebook-public-group/adapter.ts` (NEW) | Mirror of cycle-4 adapter, swap listing-URL shape, remove time-node merge (detail-fetch only) | ~250 |
| `src/adapters/facebook-public-group/parser.ts` (NEW) | Mirror of cycle-4 parser, remove time-node bucket | ~300 |
| `src/adapters/facebook-public-group/constants.ts` (NEW) | Group-slug regex, reserved-prefix list | ~50 |
| `src/adapters/facebook-public-group/{adapter,parser}.test.ts` (NEW) | Parallel test files | ~600 |
| [`src/components/admin/SourceForm.tsx`](../../src/components/admin/SourceForm.tsx) | `SOURCE_TYPES` array entry | +1 |
| [`src/components/admin/ConfigureAndTest.tsx`](../../src/components/admin/ConfigureAndTest.tsx) | `CONFIG_TYPES` / `PANEL_TYPES` set update | +0–2 |
| `src/components/admin/config-panels/FacebookPublicGroupConfigPanel.tsx` (NEW) | Group-slug field UI (mirror of `FacebookHostedEventsConfigPanel.tsx`) | ~120 |
| [`src/app/admin/sources/config-validation.ts`](../../src/app/admin/sources/config-validation.ts) + `.test.ts` | Type-specific validator + tests | +20 / +50 |
| [`src/lib/source-detect.ts`](../../src/lib/source-detect.ts) | URL pattern auto-detection (`facebook.com/groups/...`) | +12 |
| [`prisma/seed-data/sources.ts`](../../prisma/seed-data/sources.ts) | 1–2 example rows | +20 |

**Total: 10–13 files, ~800–1200 LOC.** Comparable to cycle-4's `FACEBOOK_HOSTED_EVENTS` shipping footprint. This is **NOT a gating factor** — cycle-4 accepted this footprint when the addressable surface was substantial. The spike's NO-GO comes from addressable surface, not implementation cost.

Cycle-5's planning was wrong to scope this as adapter-directory-only; the surface count is real. Recording it here so the cycle-6 planner has it pre-computed in case the verdict ever flips.

## 5. Heuristic surface

The spike plan asks: "if the SSR payload has post text, what's the heuristic for 'this post is a hash event' vs 'this post is a social photo / announcement / off-topic'?"

This question is **moot** for the verdict, but the data-points are documented anyway so the next person evaluating doesn't repeat the work.

### Posts captured from Hebe H3's main feed (n=2 unique)

| # | Post body (excerpt) | Category | Notes |
|---|---|---|---|
| 1 | "Hebe Hashers, we are looking good for the remainder of 2024…  #52 17-Feb-24, Spinky McHu & Timbits / #53 16-Mar-24, Keg on Keg on Legs / …" | **Clearly an event index** (multi-event in one post) | This is a schedule announcement, not a single event. Would need multi-event extraction (one post → 11 events). Run number + date + hares all present in regex-friendly shape. |
| 2 | "Visitor - 03-07JUN / G'day wanks! I'll be all up in Hong Kong visiting from San Diego 03-07JUN…" | **Ambiguous** | Mentions hashing but is a hasher's travel post, not a run announcement. False-positive risk on naive regex matching ("dates + 'hash'"). |

Sample size is too small (n=2) to design a heuristic against. The structural pattern from post #1 (Hebe H3's preferred format) suggests a viable shape *if* the discussion feed were accessible: line-based regex with `#<run-number> <date>, <hares>` capture would be high-precision. But the precondition is that we can see the live feed.

**Per [#1360](https://github.com/johnrclem/hashtracks-web/issues/1360) — the issue body documents the actual on-feed format:**

```
Hebe H3 Run #66, Saturday, April 19, 2025
Run Start: 3pm
Hares: Hopeless & Lost Sole
An A to A, Easter Egg Run at Man Kuk Lane Park, Hang Hau.
```

That's a single-event-per-post template with run number + ISO-friendly date + start time + hares + location, easily parseable. If accessible. It is not accessible logged-out.

### False-positive risk projection (hypothetical)

If the discussion feed were accessible, the heuristic surface would be **easier** than cycle-4 (where `__typename:"Event"` is the structural signal). Posts that aren't run announcements (visitor posts, photo dumps, polls) would mostly lack the `Run #N` token, giving high-precision matching. We have the regex shared utility `extractHashRunNumber` from [`src/adapters/utils.ts`](../../src/adapters/utils.ts) (PR [#1147](https://github.com/johnrclem/hashtracks-web/pull/1147)) that handles delimiter edge cases.

But this only matters if we can get to the live feed, which we cannot, which is why this section is bookkeeping rather than design.

## 6. Verdict + recommendation

### Verdict: **C — NO-GO**

The three failure modes from the TL;DR (≤5% public rate · public groups don't maintain Events · logged-out feed strips live content) are independent: even if one were fixable, the other two would still gate. Defer indefinitely.

### What this means for the cycle-5 plan

- **Drop the `FACEBOOK_PUBLIC_GROUP` Deep-Dive workstream proposal.** It is not a viable cycle-6 candidate either.
- The cycle-4 strategy doc's framing is validated: the FB-group-only kennel backlog (Hebe H3, the 17 confirmed-private groups in this spike, the 106 group-shape URLs in the cycle-4 audit) is addressed by **T2b paste-flow (option O7)** in [`docs/facebook-integration-strategy.md`](../facebook-integration-strategy.md), gated on kennel-admin adoption evidence. Nothing about the spike's findings changes that framing.

### Reframe (alternative paths, in priority order)

1. **Don't change anything.** Most affected kennels (Hebe H3 #1358, HKFH3 #1374) have their cycle-N data-fix issues open; those are kennel-data corrections (URL fix, name fix, profile enrichment), not adapter-design issues, and they should land on the data-fix path regardless of this spike.
2. **If/when T2b ships and gets adoption,** the paste-flow handles the public-group case (Hebe H3) and the private-group case (everything else) uniformly — Hebe H3 doesn't get special treatment for being public. This is a feature, not a missed opportunity.
3. **Owner-accepted Claude dispatch pilot (T2f, O9)** in the strategy doc is still in play for FB **Pages**; spike findings do not affect that line of work.

### What should NOT happen

- **Do not** add a `FACEBOOK_PUBLIC_GROUP` enum / source-type / adapter directory in cycle 6 because "we already did the research." The research says no.
- **Do not** close [#1360](https://github.com/johnrclem/hashtracks-web/issues/1360) on the basis of this spike. It is the parent design issue and the verdict is recorded as a comment, not as an implementation. Cycle-6 planner can decide independently whether to close or convert into a strategy-doc reference.
- **Do not** close [#1358](https://github.com/johnrclem/hashtracks-web/issues/1358) / [#1373](https://github.com/johnrclem/hashtracks-web/issues/1373) / [#1374](https://github.com/johnrclem/hashtracks-web/issues/1374). Those are kennel-data fixes on a different track.

### What the next reviewer evaluating "should we scrape FB groups" should see first

Open this doc. Read the TL;DR. Read the 22-row probe table in §1. Open `hebe-h3-events.json.fixture` and look at the 3 Event nodes — `is_past: true`, `start_timestamp` absent. That should be a 5-minute decision.

If the next reviewer believes Meta has changed something (new API access, new SSR shape), the reproducibility step is: re-run the curl + Python flow this spike used. No new scripts needed — the probe protocol is in §1 method, and the sanitization rules are in §2.

## Reproducibility

- **Date of probes:** 2026-05-11
- **Network:** residential macOS workstation, no proxy, no VPN
- **Header bundle:** identical to [`src/adapters/facebook-hosted-events/adapter.ts:44-52`](../../src/adapters/facebook-hosted-events/adapter.ts:44)
- **22 group URLs probed:** see §1 table; slugs are stable, can be replayed with `curl`
- **Probe script:** ad-hoc bash + Python; raw HTML at `/tmp/fb-spike/` on the working machine. The pattern is short enough to re-implement on demand; committing `scripts/probe-fb-group.ts` is not necessary unless this spike gets re-run periodically.
- **Sanitization step:** Python redactor inlined in the build script; sanitization rules listed in §2.

## Verification of this spike's own deliverables

- [x] `docs/kennel-research/facebook-public-group-spike.md` exists with six sections (fetchability, payload shape, ToS, admin footprint, heuristic surface, recommendation) + fixture-sanitization subsection
- [x] ≥2 sanitized fixtures committed under `docs/kennel-research/facebook-public-group-fixtures/` (delivered: 3)
- [x] Verdict is one of {GO, GO-WITH-CAVEATS, NO-GO} — **NO-GO**
- [x] No banned-path edits (`prisma/schema.prisma`, `src/adapters/registry.ts`, `src/adapters/facebook-public-group/*`, `src/components/admin/*`, `prisma/seed-data/sources.ts` are all untouched)
- [x] Comment on [#1360](https://github.com/johnrclem/hashtracks-web/issues/1360) linking spike doc + verdict (filed alongside this PR)
