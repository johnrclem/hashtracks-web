# Cowork Handoff Retro — Moonshine H3 Dubai (🇦🇪 3rd Dubai kennel) — 2026-07-01

Feedback from the Claude Code implementation session for the `2026-06-29-mh3-dxb.md` handoff — a
**config-only HARRIER_CENTRAL** onboard (the `HarrierCentralAdapter` already exists; zero new adapter
code) for Moonshine H3 Dubai, the Desert Hash House Harriers' monthly full-moon offshoot and the third
Dubai kennel. Another clean config run where **every metadata field held** and the source shape was
exactly as predicted. The productive part was downstream: the review bots (CodeRabbit + Codex) caught
**two genuine backfill data-quality issues** — both cases where a frozen row diverged from what the live
HC adapter would emit — and fixing them the "faithful to the adapter" way is the durable lesson.

**PRs produced:**
- Onboarding (config-only HC source + kennel/alias seed + self-hosted JPEG logo + 17-run backfill):
  [PR #2484](https://github.com/johnrclem/hashtracks-web/pull/2484) (merged). **Three commits** — onboard
  base, then two review-driven fixes: (a) strip #351's placeholder `"TBD"` venue, (b) keep the online
  #360 run unlocated by moving its note out of the geocoded `location` field.
- Docs (this retro + run-log/queue → SHIPPED, plus the bundled Hua Hin Full Moon H3 handoff from the
  2026-07-01 daily run): this PR.

**Outcome:** Live at `https://www.hashtracks.xyz/kennels/moonshine-h3-dubai` — **18 canonical events**
(17 backfilled history **#347 @ 2025-02-14 → #363 @ 2026-05-29** + 1 upcoming **#364, Fri 2026-07-03
20:00, hares Spiv**), all CONFIRMED, monthly full-moon cadence. Post-merge ran from an **isolated
worktree** (the main repo held unrelated Hua Hin doc WIP): `db seed` (additive — new kennel/source/alias,
no other source's config to revert since the seed matched current main), `BACKFILL_APPLY=1` backfill
(**created=17, 0 errors, 0 blocked**), then `scrapeSource` (**eventsFound 1 / created 1 / cancelled 0** —
`cancelled=0` proves the `upcomingOnly` contract held against the future-only adapter). The online #360
correctly rendered **unlocated** (coords ∅) rather than pinned to a real Dubai venue.

---

## The loop is working — previous retro discipline LANDED

1. **Live-verify END-TO-END before CI.** `adapter.fetch(source)` against the live HC Azure feed returned
   the 1 upcoming run — `kennelTags:["mh3-dxb"]`, `startTime "20:00"`, `runNumber 364`, title "Moonshine
   Run 364", hares "Spiv" — 0 malformed rows. Reconfirmed from local env (the Azure host is
   allowlist-blocked from the research sandbox; the handoff flagged it). [live-verification]
2. **`upcomingOnly:true` because the backfill ships** — the Bandung #2340 contract. The post-merge scrape
   returned `cancelled=0`, proving the 17 backfilled past rows survived reconciliation against the
   future-only adapter. [hc-global-runs-past-backfill]
3. **HC history via the `global-runs` past-window pull** — `?isFuture=0&minEventDate=&maxEventDate=`
   (both dates REQUIRED), 6-month windows, filtered client-side on `PublicKennelId`, PascalCase rows.
   17 runs #347–#363 (Feb 2025 → May 2026 — HC-join-forward, not the ~1990s founding). [hc-global-runs-past-backfill]
4. **Frozen JSON + dumb loader, mirroring `backfill-bandung-h3-history.ts`** — no committed parser; the
   loader routes through the shared `runBackfillScript` → `reportAndApplyBackfill` → `processRawEvents`,
   so canonical Events are created in the same pass (no orphan RawEvents). [backfill-must-route-through-merge-pipeline]
5. **Isolated worktree, never the main repo.** All prod writes ran from the worktree; the main repo's
   unrelated Hua Hin Full Moon doc WIP was left intact and is shipped in this docs PR. [worktree-bash-cwd-resets-to-main]

---

## What the handoff got RIGHT (keep doing)

1. **Config-only HC, GUID-filtered, every metadata field held** — `publicKennelId`, `defaultKennelTag`,
   `defaultTitle`, `staleTitleAliases`; hashCash 10 AED, monthly full-moon 8:00 PM, website = the DH3
   Moonshine page — all shipped as written. HC's real `EventName`s ("MH3D Run N" / "Moonshine Run N")
   pass through verbatim; `defaultTitle` never had to fire.
2. **Lunar cadence → NO `scheduleRules`.** The run *day* drifts with the full moon (sampled Mon/Wed/Fri),
   so the handoff correctly specified `scheduleFrequency:"Monthly"` + `scheduleNotes` and **omitted** any
   fixed-weekday RRULE — a `BYDAY` rule would mis-project. The dated HC feed is authoritative.
3. **0 `region.ts` edits** — UAE COUNTRY + Dubai METRO + `dubai` inference all already shipped via Desert
   H3 (PR #2294); reused verbatim, confirmed present, not re-added.
4. **kennelCode / alias hygiene** — `mh3-dxb` (bare `mh3`/`MH3` globally taken:
   Munich/Montreal/Minneapolis/Miami/Madrid/Memphis/Morgantown/Manila → region-suffixed), bare "MH3"
   alias omitted. Grep-clean.
5. **The 3 pre-flagged data-quality decisions were all correct** — #360 online (fee 0, no coords), #361
   08:00 outlier (GMT agrees → preserve verbatim, not a 12h typo), #363 hares = venue string (HC
   location-bleed → drop hares, keep venue). All shipped and verified in prod.

---

## Handoff GAPS → research-prompt / platform-notes improvements (the actionable part)

1. **🔑 NEW LESSON — an online/virtual backfill row must CLEAR `location`, not just omit coords.** The
   handoff for #360 said "keep the 'Online due to current security climate in Dubai…' text, drop coords".
   But omitting lat/lng is a **half-fix**: `resolveCoords` (`merge.ts:~1290`) geocodes `event.location`
   whenever coords are absent and the text is truthy — and a sentence containing "Dubai" geocodes to a
   **real Dubai pin** that passes the 200 km kennel-proximity check, so a virtual run would show a
   physical location. This is distinct from the existing placeholder-sentinel note (TBD/TBA get stripped
   by `stripPlaceholderLocation`): a free-text "Online due to…" sentence is NOT a sentinel and won't be
   caught. Fix (Codex P2, verified in prod — #360 shipped unlocated): put the note in **`description`**
   (which merge never geocodes) and omit `location` entirely. → **platform-note add** (HC / global-runs
   backfill): for an online/virtual/no-physical-venue row, clear `location`; the geocoder will pin ANY
   truthy location text, and a city-mentioning sentence yields a real pin, not a centroid fallback.
2. **A literal `"TBD"` venue in a frozen backfill row diverges from live-adapter output.** #351's HC
   `LocationOneLineDesc` was the placeholder `"TBD"`. The frozen JSON stored it verbatim — but the live
   HC adapter's `stripPlaceholderLocation` (whose `GEOCODE_FAIL_SENTINELS` set includes `"tbd"`) would
   emit `undefined`. CodeRabbit caught the divergence. Fix: mirror the adapter — drop `"TBD"` (and the
   rest of the sentinel family) at freeze time so backfilled rows match what a live scrape would produce.
   → **research-prompt add:** when curating a frozen HC backfill, run each `LocationOneLineDesc` through
   the same sentinel list the adapter uses; store `undefined`, not the placeholder.
3. **Cost/description are NOT emitted by the live HC adapter** — the adapter's `RawEventData` carries no
   `cost` or `description`. Mirroring it, the frozen backfill omits both (kennel-level `hashCash` "10 AED"
   covers cost). The one exception is #360, where `description` is the *right* home for the online note
   (gap #1). Principle: a backfill row should match live-adapter output field-for-field except where a
   documented data-quality decision requires otherwise. (No change needed — worked as intended; noted so
   the next HC backfill doesn't gratuitously add per-event cost/description.)

---

## Net

A textbook config-only HC onboarding: research held, source shape exactly as predicted, lunar-cadence
schedule modeled correctly (no RRULE), 0 region edits, clean kennelCode/alias hygiene. The value was in
the two review-caught backfill fixes — both instances of the same principle, **a frozen backfill row
should faithfully match what the live adapter would emit** — which produced one genuinely new, reusable
platform lesson: *omitting coords doesn't keep a row unlocated; the merge geocodes the location TEXT, so
an online/virtual event must clear `location` and carry its note in `description`.* Third Dubai kennel is
live with 16 months of HC-join-forward history and its full-moon cadence intact.
