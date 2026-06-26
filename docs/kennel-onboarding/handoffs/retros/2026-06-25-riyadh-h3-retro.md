# Cowork Handoff Retro — Riyadh H3 / R3H4 (🇸🇦 first Saudi Arabia kennel) — 2026-06-25

Feedback from the Claude Code implementation session for the `2026-06-25-riyadh-h3.md` handoff — a
**NEW lightweight Supabase/PostgREST JSON adapter** (NOT config-only) for a Lovable React/Vite SPA,
plus the first **Saudi Arabia COUNTRY + Riyadh METRO** region and a 58-run historical backfill. The
config-style core was as clean as the handoff promised — one `safeFetch` + a column map, zero
Cheerio. But this was the first onboard where the **live API was richer than the recon's documented
sample**, and that gap (plus a hardcoded-key security gate and an adversarial fingerprint finding)
drove every substantive change. The four review bots (Codex, CodeRabbit, claude[bot],
SonarCloud/Codacy) each earned their keep.

**PRs produced:**
- Onboarding (adapter + tests, kennel/alias/source seed + Saudi Arabia/Riyadh region + self-hosted
  logo + backfill script + a shared-fingerprint coordinate fix):
  [PR #2387](https://github.com/johnrclem/hashtracks-web/pull/2387) (merged). **Four commits** —
  onboard base, a `/simplify` tighten, the CI-review batch (env-var key, TZ boundary, lints), then
  the adversarial-review fingerprint fix.
- Docs (this retro + run-log/queue → SHIPPED + the Supabase platform-notes correction): this PR.

**Outcome:** Live at `https://www.hashtracks.xyz/kennels/r3h4` — **59 canonical events** (1 upcoming
**#2493 Fri 2026-06-26 16:30** "Dead Camel Rage" + 58 historical back to **#2415 2025-01-03**), 51
with real coordinates, all CONFIRMED, real theme titles. Post-merge ran from the **main repo**
(clean — `git status` showed only the doc-WIP `target-queue.md`, no conflict): `prisma db seed`
(additive — **Created 1 / Updated 436**, "No stale rules found"), then `BACKFILL_APPLY=1
…backfill-riyadh-h3-history.ts` (**created=58, blocked=0, errors=0**), then a one-shot
`scrapeSource(id,{force:true})` (**eventsFound 1 / created 1 / 0 errors**). Prod `psql` confirmed: 59
events, date range 2025-01-03→2026-06-26, real titles + run numbers. The Vercel
`RIYADH_H3_SUPABASE_ANON_KEY` env var was set (Production + Development) so the daily cron scrapes.

---

## The loop is working — previous retro discipline LANDED

1. **Live-verify END-TO-END before CI.** `adapter.fetch(source)` from local env returned the
   verbatim oracle (#2493, 2026-06-26, `startTime:"16:30"`, `kennelTags:["riyadh-h3"]`, coords, 0
   errors) — and re-extracting the **rotated** `anon` key was the first build step, exactly as the
   handoff flagged.
2. **Worktree vitest exclude workaround.** Tests run from `.claude/worktrees/**` zero out (the
   config's exclude matches every path); used a temp `vitest.local.config.ts` minus that exclude,
   deleted before commit (`prisma generate` first). Recurred again — this is now a reliable pattern.
3. **Magic-byte the logo extension.** The source URL ended `.png` AND the HTTP header said
   `image/png`, but the magic bytes were **JFIF** → self-hosted as `riyadh-h3.jpg`. The literal
   "confirm ext by magic bytes" instruction (don't pre-fill `.png`) paid off — both the URL and the
   Content-Type were misleading.
4. **First-country = all 5 `region.ts` edits, palette grep-before-pick.** Saudi Arabia COUNTRY +
   Riyadh METRO, **teal** (grep-confirmed clear of UAE's amber and every Gulf/Asian neighbour),
   abbrev **KSA** not bare `SA` (South Australia owns that alias), inference tokens
   `saudi arabia|saudi|riyadh|ksa` (no bare `sa`). `inferCountry("Riyadh")` → Saudi Arabia verified.
5. **`upcomingOnly:true` as a reconcile-safety contract.** The `hikes` table returns full 2025+
   history on every scrape, so the adapter future-window-filters (`date=gte.today`) and the source
   sets `upcomingOnly:true` — reconcile clamps `timeMin=now` and never false-cancels the backfilled
   past rows. Matches the Bandung §A correction; applied from the start here.

---

## What the handoff got RIGHT (keep doing)

1. **The Supabase platform note was accurate on shape.** Empty SPA shell → API mandatory; `anon` key
   publishable (`role:anon`, RLS-gated); `?select=…&order=date.desc&deleted_at=is.null`; one query =
   full history; future/past split (adapter `gte.today`, backfill `lt.today`). The recipe held.
2. **The keyless-401 caveat was correct.** A keyless probe 401s at the gateway before PostgREST
   resolves the table, so table existence stayed unproven until the authenticated pull — which is
   exactly how it played out. "Source verified" was correctly gated on the real row pull.
3. **The Thu/Fri flag.** The handoff explicitly said "trust the `date` column over the recon card."
   That instruction was the single most valuable line (see Gap A).
4. **Metadata sourced, not guessed.** foundedYear + hashCash left blank (no citable source — the
   bundle scan confirmed none); the generic "Riyadh Hiking" clubs correctly **not** attributed.
5. **Fail-loud guards.** Non-array body + zero-upcoming-rows both push `errors[]` so reconcile is
   suppressed — right for a single-surface source whose healthy baseline is tiny.

---

## Handoff GAPS → research-prompt / platform-notes improvements (the actionable part)

### A. 🔴 The recon's documented sample was a SUBSET of the live schema — live-verify revealed richer data

The handoff's field-fill table (from the 2026-06-18 recon's single documented #2492 row) said the
feed carried only `run_number/title/date/location/gathering_time/circle_time/difficulty/
registration_status` — **no coords, no maps link, no description**, and titles were "place-name dups
→ leave undefined." The **live `hikes` rows pulled at build carried three more populated columns**:
`map_link` (Google Maps shortlink, 54/59 → `locationUrl`), `location_gps` (DMS, 30/59 → parsed to
lat/lng via `parseDMSFromLocation`), and a real `description` (run blurb). And the weekday + titles
were both different (Gaps B/C). The recon froze one row's shape; the live table had evolved/was
fuller.

> **Process note (→ research prompt + platform notes):** treat a recon's documented sample row as a
> *floor*, not the schema. The mandatory build-time `adapter.fetch` must **re-inspect the full column
> set** (`select=*` once during verification) and opportunistically map every user-visible field
> present — `map_link`→`locationUrl`, DMS `location_gps`→coords, `description` — not just the columns
> the recon happened to capture. The live-verification rule exists precisely because the source
> outruns the recon.

### B. 🔴 Weekday was FRIDAY, not Thursday — the data column won decisively

The queue + run-log asserted "weekly Thursday" (from the recon card's "Thursday 18 Jun 2026"); the
JSON `date` for #2492 was `2026-06-19` (a Friday). A weekday tally of all 59 rows: **58 Friday, 1
Saturday, 0 Thursday.** Friday is the Saudi weekend day. Set `scheduleDayOfWeek: "Friday"`. The
handoff's own "trust the `date` column" instruction made this a 30-second resolution — but the
*assertion* fields (queue Status note, run-log metadata) still said Thursday and would have shipped
wrong without the build-time tally.

> **Process note (→ research prompt):** when a recon's human-readable card disagrees with a
> machine-readable `date` field, the data column is authoritative — and the handoff's metadata
> line should be written as "Friday (per the `date` column); the card said Thursday — card is wrong"
> rather than leading with the card's value + a "confirm" flag. Tally the weekday across the **whole
> feed**, not one row.

### C. 🔴 Titles were real themes (56/59), not place-name dups — keep them

The handoff said leave `title` undefined and let merge synthesize "Riyadh H3 Trail #N", on the
premise that titles were place-name dups of `location`. The full feed showed the opposite:
**"Dead Camel Rage", "Dark Night Hash - 22nd st", "Amariah River 2nd Right"** — 56/59 are real
trail themes; only 3 were place-name-ish, and even those are real human-entered titles worth
keeping. Mapped `title` verbatim (trim → undefined only when blank). This is the
[verify-issue-naming-premise-against-archive] failure mode: a single-sample premise about field
shape was wrong against the archive.

> **Process note (→ research prompt):** never decide "drop this field / it's a dup" from one sample.
> Pull the whole column and eyeball the distribution. Default to **keeping** a real source field
> (a human-entered title is recoverable; a dropped one is gone) unless the archive shows it's
> overwhelmingly junk.

### D. 🔴 The publishable `anon` JWT still trips secret-scanners — it belongs in an env var, not committed

The handoff (and the platform note) said the `anon` key is "safe in source config or an adapter
constant" because it's publishable. True for *security* — but **Codacy's secret scanner flagged the
hardcoded JWT as 3 critical findings and failed the PR gate** (SonarCloud passed; Codacy is
stricter). Excluding the whole adapter file via `.codacy.yml` was too broad. The fix that satisfied
the scanner AND CodeRabbit's "backfill can drift from source config" comment: move the key to a
**`RIYADH_H3_SUPABASE_ANON_KEY` env var** (no literal in git), read by both the adapter and the
backfill via a shared `resolveRiyadhAnonKey()` (optional `config.supabaseAnonKey` override), failing
loud if unset. This matches how the repo handles every other key (CLAUDE.md env list).

> **Process note (→ platform notes, Supabase section):** a publishable-but-secret-shaped key (a JWT,
> even `role:anon`) should be seeded via an **env var**, not a committed constant or `Source.config`
> literal — Codacy's hardcoded-secret detector fails the gate regardless of the key's real
> sensitivity. Document the new env var in CLAUDE.md and **set it in Vercel (Production) before
> merge** or the cron scrape fails loud (no events) until it's present.

### E. 🔴 NEW SHARED-INFRA — coordinates didn't participate in the RawEvent fingerprint (adversarial review)

Codex's adversarial review found a real gap **beyond Riyadh**: `generateFingerprint` hashed
`locationUrl` but **not** `latitude`/`longitude`, and `handleDuplicateFingerprint` →
`refreshExistingEvent` only writes `dateUtc`/`timezone`. So an adapter that emits per-event
coordinates from a *mutable* source field (Riyadh's DMS `location_gps`; Harrier Central's
`syncLat/syncLong`) could **correct a pin while every fingerprint field stayed identical**, and the
corrected lat/lng would be silently dropped at the dedup layer. Verified both halves against the
code, then added a **gated coordinate token** to `generateFingerprint` (same locationStreet/endDate/
eventLabel precedent — coord-less events fingerprint identically; only coord-bearing rows
re-fingerprint once, a distributed per-source idempotent re-merge à la #1316) + two fingerprint
tests. This hardens every coord-emitting adapter, not just Riyadh.

> **Process note (→ platform notes):** when an adapter emits per-event `latitude`/`longitude` from a
> mutable source column, those coords now participate in the fingerprint (gated token, #2387) — a
> pin correction re-merges. No adapter action needed; this is shared-infra, documented so future
> coord adapters know corrected pins propagate.

### F. 🟡 `tsx -e` one-liners don't load `.env` — they hit a phantom local DB

Two build-time verification one-liners (`npx tsx -e 'import {prisma}…'`) failed with **"Database
`johnclem` does not exist"** — because `tsx -e` does NOT auto-load `.env`, so `@/lib/db` fell back
to a default localhost/OS-user connection. The backfill *script* worked (it has
`import "dotenv/config"`); the `-e` snippets didn't. Fix: prepend `import "dotenv/config";` to any
`tsx -e` that touches the DB, or use `psql` (which I did for the prod verification — more reliable
against Railway anyway).

> **Process note (→ platform notes / implementation learnings):** prod-DB `tsx -e` probes need an
> explicit `import "dotenv/config"` first, or they connect to a phantom local DB and throw a
> confusing "database <user> does not exist." Prefer `psql "$DATABASE_URL"` for quick prod reads.

---

## Implementation / process learnings (loop context)

1. **🟢 Asia/Riyadh date boundary for the forward/past split.** Both the adapter and the backfill
   compute "today" via a shared `riyadhToday()` (`Intl.DateTimeFormat('en-CA', {timeZone:
   'Asia/Riyadh'})`), not `toISOString()` (UTC) — so a row is classified by the kennel's local
   calendar day. CodeRabbit + claude[bot] both flagged the UTC version (a ≤3-hour misfile near
   midnight Riyadh). Fixed before merge.
2. **🟢 Post-merge ran from the MAIN repo — clean.** `git status` showed only the doc-WIP
   `target-queue.md` (no code conflict); plain `pull --ff-only` to the merge commit, `prisma
   generate` once, then `db seed` / backfill apply / scrape against the prod `.env`.
3. **🟢 One-shot `scrapeSource(id,{force:true})` to publish the upcoming run** (not the cron
   endpoint). The `after()`/`revalidateTag` "called outside a request scope" warnings are expected
   for a CLI script and non-fatal (`success:true`, `errors:[]`); the page rendered fresh anyway.
4. **🟢 Merge geocoder correctly rejected bad text-geocodes.** Events without DMS coords fell back to
   geocoding the `location` text; the validator rejected several that resolved hundreds of km from
   the Riyadh centroid (a wrong "Ammairyah") → centroid fallback, no bad pins. Events WITH DMS coords
   kept precise pins (51/59 ended with coordinates).
5. **🟢 `/simplify` + `/codex:adversarial-review` before merge.** `/simplify` (4 parallel cleanup
   agents) applied 3 tightenings (dropped a redundant `buildDateWindow`, removed the unused config
   field, shared `HIKES_SELECT`); all four agents independently judged the bespoke adapter the right
   YAGNI call (zero other Supabase sources). The adversarial pass produced Gap E.
6. **🟢 Vercel env var via CLI** — Production + Development set; **Preview** hit a CLI prompt-mode
   glitch (the outdated 51.x CLI) and was skipped — non-essential, cron runs in Production.
7. **🟢 Kennel slug is `r3h4`** (derived from shortName), not `riyadh-h3` (the kennelCode). The
   runbook's `/kennels/riyadh-h3` guess was wrong; the page is at `/kennels/r3h4`. [kennel-url-is-slug]

---

## TL;DR for the research prompt + platform notes

1. **Supabase/PostgREST SPA onboard is clean** — one `safeFetch` + a column map, future/past split,
   `upcomingOnly:true`, fail-loud guards. The platform note's shape held.
2. **🔴 NEW — the recon sample is a FLOOR, not the schema.** Build-time `adapter.fetch` must
   re-inspect the full column set and map every user-visible field present (Riyadh's live feed had
   `map_link`/`location_gps`/`description` the recon row didn't). The source outruns the recon.
3. **🔴 NEW — single-sample premises about a field (weekday, title-is-a-dup) are unreliable.** Tally
   the weekday across the whole feed (Friday, not the card's Thursday); keep real source titles
   (56/59 were themes, not place dups). Verify field shape against the archive.
4. **🔴 NEW — a publishable JWT still fails Codacy's secret gate → env var, not a committed literal.**
   `RIYADH_H3_SUPABASE_ANON_KEY`, read by adapter + backfill, documented in CLAUDE.md, **set in
   Vercel before merge** (else cron scrapes fail loud). (Platform-notes Supabase section corrected.)
5. **🔴 NEW (shared-infra) — per-event coords now participate in the fingerprint** (gated token,
   #2387), so a corrected pin re-merges. Applies to every coord-emitting adapter.
6. **🟡 `tsx -e` DB probes need `import "dotenv/config"`** or they hit a phantom local DB; prefer
   `psql "$DATABASE_URL"`. And use the kennel **slug** (`r3h4`), not the kennelCode, for the page URL.
7. **Keep:** live-verify-first + the rotated-key re-extract, the magic-byte logo discipline, the
   first-country 5-edit + palette-grep, the `upcomingOnly` reconcile contract, the worktree-path +
   temp-vitest-config discipline, and the Asia/<city> local-date split boundary.
