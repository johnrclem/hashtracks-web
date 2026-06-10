# Cowork Handoff Retro — Budapest H3 (🇭🇺 HashTracks' first Hungary kennel, est. 1982) — 2026-06-09

Feedback from the Claude Code implementation session for the `2026-06-09-budapest-h3.md` handoff —
a **config-only `STATIC_SCHEDULE`** onboard (×2 summer/winter rows, mirror NOSE Hash) + new **Hungary
COUNTRY + Budapest METRO** region (5 `region.ts` edits, orange) + a self-hosted logo. No new adapter
code, no backfill. The handoff was high-fidelity and most of it held — but two things diverged
**between research (2026-06-09) and build (2026-06-10)** that are worth turning into process: the
kennel's canonical website went **NXDOMAIN** in the interim, and a latent **seed × backfill
interaction** (flat schedule fields → a stale all-year schedule rule) surfaced in review.

**PRs produced:**
- Onboarding (kennel/alias/2 sources + Hungary COUNTRY/Budapest METRO + self-hosted logo + seasonal
  `scheduleRules` fix): [PR #2096](https://github.com/johnrclem/hashtracks-web/pull/2096) (merged).
  Three commits — the seed/region base, a region-inference fix (Gemini/CodeRabbit), and the
  `scheduleRules` fix (Codex P2).
- Docs (this retro + run-log/queue → SHIPPED + 2 platform notes): this PR.

**Outcome:** Live at https://www.hashtracks.xyz/kennels/budapest-h3 — **13 upcoming canonical Events**
(weekly Sundays 2026-06-14 → 09-06 @ 11:30, summer), kennel page rendering the seasonal schedule
"Sundays 11:30 AM (Summer, Apr–Oct) / 10:30 AM (Winter, Nov–Mar)", Est. 1982, HUF 1,000. Post-merge
ran from the **worktree** on prod `.env` (main repo carried the user's uncommitted doc WIP on a stale
base): seed (additive — kennel/5 aliases/2 sources + Hungary/Budapest regions; **Created 2 / Updated
385** ScheduleRules, "No stale rules found"), then `scrapeSource(force:true)` on both rows →
**eventsFound 3+ / 0 unmatched / 0 blocked / 0 errors**, 13 canonical events in the forward window.

---

## The loop is working — previous retro fixes LANDED

1. **New-country 5-edit `region.ts` checklist (ONH3 / Mijas / Paris / Mexico retros).** The handoff
   carried all five edits explicitly (REGION_SEED_DATA COUNTRY+METRO, `COUNTRY_INFERENCE_RULES`,
   `STATE_GROUP_MAP`, `COUNTRY_GROUP_MAP` country-only key, `COUNTRY_CODE_TO_NAME`) mirroring the
   Portugal/Lisbon precedent, and called out the `inferCountry → "USA"` failure mode (the ONH3/Kenya
   bug). Landed clean — `inferCountry` verified for Budapest/Hungary/Magyarország → Hungary.
2. **Source-pivot evidence package (WSH3 verify-handoff-source-exists).** The handoff proved the
   *queued* sources dead before pivoting — `meetup.com/budapest-hash-house-harriers` = "Group not
   found", `budapesthash.hu` = NXDOMAIN, `bph3.blogspot.com` dead since 2014, HC `getEvents` Budapest
   = 0. Correct pivot to the kennel's own published fixed schedule (STATIC_SCHEDULE, NOSE precedent).
3. **kennelCode collision discipline.** `budapest-h3` checked clear; bare `bh3` is Buffalo + `bh3-co`
   Boulder, bare "BH3"/"BHHH" omitted as globally taken. Verified absent in seed + live sitemap (436).
4. **`<ext>` logo placeholder, confirm via magic bytes (ah3-nz / Paris / Mexico retros).** The handoff
   said "self-host, confirm extension by magic bytes, never pre-fill `.png`". Asset was a genuine PNG
   (`\x89PNG`, 508×247 RGBA) — referenced `/kennel-logos/budapest-h3.png`.
5. **Split adapter-verify from post-merge seed (ZH3 retro).** Handoff structured it exactly so —
   `adapter.fetch()` (no DB write) pre-PR; `prisma db seed` + `scrapeSource` as a separate post-merge
   runbook. Landed.
6. **`foundedYear` medium-confidence flag (Mexico/Brasília retros).** Handoff marked 1982 medium-confidence
   (secondary sources) and asked to confirm. Confirmed from the kennel's own copy ("founded in 1982 …
   almost 1,700 runs") via the search-index snapshot of the home page — the flag did its job.

---

## What the handoff got RIGHT (keep doing)

1. **STATIC_SCHEDULE summer/winter split was the right path.** Per-run hares/locations are members-only
   (private FB group); the kennel publishes a fixed weekly-Sunday cadence (summer 11:30 / winter 10:30).
   Two disjoint-`BYMONTH` STATIC_SCHEDULE rows (mirror NOSE Hash) = config-only, zero new adapter code,
   no double-generated Sunday. Generated exactly as written: 13 upcoming Sundays @ 11:30.
2. **Distinct `url` on the two rows keeps them separate Source records.** Summer `…org`, winter
   `…org/#winter` (mirrors NOSE's `…#winter-wed`). Both seeded enabled, configs intact post-seed.
3. **`kennelCodes` guard on both rows.** `["budapest-h3"]` set on each → 0 blocked at scrape (the
   source-kennel guard passed; both `SourceKennel` links present).
4. **The recently-active evidence stood in for a feed sample.** STATIC_SCHEDULE has no feed; the handoff
   cited the live maintained site + 975-member active FB group (public About confirms the schedule
   verbatim) as current-activity evidence. Correct framing for a generated source.
5. **Region color picked to avoid neighbors.** Orange (`#ea580c`/`#f97316`) vs Austria=teal,
   Switzerland=red, Portugal=green. (Belgium=amber is the nearest clash but far apart on the map — kept;
   flagged as a swap-if-it-clashes watch item.)

---

## Handoff GAPS → research-prompt / process improvements (the actionable part)

### A. 🔴 The handoff's "live source ✅" was NXDOMAIN at BUILD time — the domain lapsed BETWEEN research and build

The daily research run verified `budapesthashhouseharriers.org` live on 2026-06-09 (web_fetch returned
the full home page). At build (2026-06-10, <24h later) it resolved **NXDOMAIN** across Google DNS,
Cloudflare DNS, **and** Anthropic's fetch infra — apex + www, A + NS, `.org` SOA in authority = a real
registration lapse (almost certainly a renewal-grace blip), not a sandbox quirk (GitHub resolved fine).
The handoff treated the website as a live oracle; it was unreachable when it mattered.

This is a **new variant** of the WSH3 "verify the handoff's source actually exists" rule: not "the
handoff named a dead source" but "the handoff's verified-live source went dead in the gap." Mitigations
that worked and should be the playbook:
- **Re-verify the handoff's named website DNS at build time**, even when the handoff says it's live.
- **Recover the logo (and confirm content) from the Wayback Machine** when the origin is down — the site
  was WordPress/Astra; Wayback CDX had `wp-content/uploads/2021/09/cropped-logo.png`; pulled the raw
  bytes via the `https://web.archive.org/web/<ts>id_/<url>` identity modifier, magic-byte-verified PNG.
  So we shipped *with* the real logo despite the dead origin. (→ new platform note.)
- **Confirm flagged metadata (`foundedYear`) from the search-index snapshot** when the live page is gone.
- **Keep the canonical URL as `website`** (recoverable lapse; the kennel page still surfaces the live
  `facebookUrl`) and document it as a re-check item — CodeRabbit flagged the broken link, I declined with
  this rationale, and CodeRabbit **accepted** it as an intentional reversible exception.

> **Prompt change (suggested):** add a build-time step — "DNS-resolve every website/source URL the
> handoff marks live before trusting it; if NXDOMAIN, recover the logo/content from the Wayback Machine
> (`web/<ts>id_/` raw-bytes modifier) and keep the canonical URL as a documented re-check item." The
> daily run's live check is necessary but not sufficient — domains lapse in the research→build gap.

### B. 🔴 Seasonal STATIC_SCHEDULE + flat schedule fields → a stale all-year backfill rule (Codex P2)

The handoff (correctly mirroring NOSE) used only the flat `scheduleDayOfWeek/Time/Frequency` fields.
But `scripts/backfill-schedule-rules.ts` (run by `prisma db seed`) Pass 1 emits HIGH rules from each
source's BYMONTH rrule, while Pass 2 parses the flat fields into a bare `FREQ=WEEKLY;BYDAY=SU` and its
coverage check is **exact-string** — so it never matches the BYMONTH-bearing Pass 1 rules and **emits a
stale all-year `FREQ=WEEKLY;BYDAY=SU` @11:30 SEED_DATA rule** that mis-projects 11:30 in winter (when
the kennel actually runs 10:30). Codex caught it (P2).

Fix (mirrors **LBH3**, itself shaped by Codex on PR #1684): add seasonal `scheduleRules` with
`label`/`validFrom`/`validUntil`/`startTime`. This structurally opts the kennel out of Pass 2 (any
kennel declaring `scheduleRules` is skipped) and Pass 3 absorbs the overlapping Pass 1 rows. **Same-day
gotcha:** both Budapest seasons run Sunday, so (unlike LBH3's TH/SU split) the `scheduleRules` rrules
must **retain BYMONTH** (`…BYMONTH=4,5,…` vs `…BYMONTH=11,12,1,2,3`) — else the two rules collide on the
`(kennelId, rrule, source)` upsert key, and matching the source rrules exactly is what lets Pass 3
absorb Pass 1. Verified: both rrules `parseRRule`-parse and `normalizeRRule` is identity; prod shows
**exactly 2 active rules, no stale all-year rule**.

This is **latent in every existing seasonal STATIC_SCHEDULE kennel** (NOSE / Tidewater / Rumson all use
flat-fields-only and would emit the same stale rule).

> **Prompt change (suggested):** for a seasonal (summer/winter) STATIC_SCHEDULE kennel, the handoff
> should specify `scheduleRules` (one per season, with `validFrom`/`validUntil`/`startTime`), not just
> the flat fields — keep the flat fields as legacy fallback. Same-day-different-time seasons must keep
> `BYMONTH` in the rrules. (→ new platform note + agent memory.)

### C. 🟡 `scheduleTime` "11:30" (24h) again — repo convention is 12-hour "11:30 AM"

Recurring from Mexico Gap B / Paris Gap E: the handoff seed used `scheduleTime: "11:30"` for the kennel
**display** field; the repo convention (Buffalo "1:00 PM", Mexico "1:30 PM") is 12-hour. Set
`scheduleTime: "11:30 AM"`. Note the STATIC_SCHEDULE `config.startTime` IS 24-hour `"11:30"`/`"10:30"` —
two different fields, two formats; don't conflate them.

> **Prompt note:** already covered by prior retros — the 12-hour rule applies to `Kennel.scheduleTime`
> (display), NOT the STATIC_SCHEDULE `config.startTime` (which is "HH:MM" 24h). Reinforced here.

---

## Implementation / process learnings (loop context)

1. **🟢 Post-merge ran from the worktree, NOT the main repo (PIH3/Mexico precedent).** The main repo
   (`/hashtracks-web`) carried the user's uncommitted doc WIP (run-log/target-queue/source-platform-notes
   — incl. the Budapest+Taiwan HANDED OFF entries) on a base behind `origin/main`; a `git pull` would
   have clobbered it. So seed + `scrapeSource` ran from the worktree (tree == `origin/main` after the
   merge) with the prod `.env` (the worktree has none — must use the main repo's, or run with cwd there).
   `npx prisma generate` once per fresh checkout (gitignored `@/generated/prisma`). Node 25 (no `fnm`;
   25 satisfies Prisma 7's "20+").
2. **🟢 Standalone tsx verify scripts need explicit `.env` + the right TLS path (script-env-loading +
   new context).** Two traps: (a) `npx tsx -e` does NOT auto-load `.env` — prepend `import "dotenv/config"`
   (the `db seed` itself is fine; `prisma.config.ts` loads it). (b) `scripts/lib/createScriptPool`
   enforces strict TLS and **rejects the Railway proxy's self-signed cert** — either set
   `BACKFILL_ALLOW_SELF_SIGNED_CERT=1`, or mirror `seed.ts` and construct `new PrismaPg({connectionString})`
   directly; for `scrapeSource` (which imports `@/lib/db`), run with `NODE_ENV=production` so the singleton
   uses `ssl:{rejectUnauthorized:false}`.
3. **🟢 CLI-context scrape `revalidateTag … no request scope` is expected and harmless.** `safeRevalidateTag`
   no-ops outside a Next.js request; the DB writes persisted and the live page rendered all 13 events on
   first load (the cache revalidated naturally). Same as the PIH3 retro's `after()`/`revalidateTag` note.
4. **🟢 Live-verify proved END-TO-END before CI.** `adapter.fetch(source)` for both rows over an 18-month
   window confirmed Sundays-only / in-BYMONTH / correct startTime / `kennelTags=["budapest-h3"]`, before
   tsc/lint/test (8830 green). A prod query after seed+scrape then confirmed kennel + 2 sources
   (config intact) + 2 regions + **exactly 2 seasonal ScheduleRules (no stale rule)** + 13 events.
5. **🟢 Four review threads, all handled; no churn on the gates.** Gemini + CodeRabbit both flagged the
   `magyarország` inference miss (`\bmagyar\b` can't reach inside `magyarország`) → fixed (added
   `magyarorszag|magyarország`; `inferCountry` lowercases so no `u`/`i` flag needed). CodeRabbit's
   NXDOMAIN-`website` flag → declined with the lapse rationale, **accepted** by CodeRabbit as a documented
   reversible exception. Codex P2 (Gap B) → fixed. SonarCloud 0 new issues / 0 hotspots, Codacy 0 — the
   data-only change had no analyzer surface.

---

## TL;DR for the research prompt + platform notes

1. **Seasonal STATIC_SCHEDULE kennels need `scheduleRules`, not just flat fields.** Flat-fields-only →
   backfill Pass 2 emits a stale all-year rule that mis-projects the off-season time. Add one
   `scheduleRules` entry per season (`validFrom`/`validUntil`/`startTime`); keep flat fields as fallback.
   **Same-day seasons must keep `BYMONTH`** in the rrules (collision on `(kennelId,rrule,source)` + lets
   Pass 3 absorb Pass 1). Latent in NOSE/Tidewater/Rumson. (Prompt + platform note + memory updated.)
2. **Re-verify the handoff's named website/source DNS at BUILD time** — it can lapse between research and
   build (Budapest `.org` went NXDOMAIN <24h after the daily run verified it). When the origin is down:
   **recover the logo/content from the Wayback Machine** (`web/<ts>id_/` raw-bytes modifier, magic-byte
   verify), confirm flagged metadata from the search index, and keep the canonical URL as a documented
   re-check item. (New variant of the WSH3 verify-source-exists rule; platform note added.)
3. **`Kennel.scheduleTime` is 12-hour ("11:30 AM"); STATIC_SCHEDULE `config.startTime` is 24-hour
   ("11:30").** Two fields, two formats — don't conflate.
4. **Keep:** the source-pivot evidence package (prove queued sources dead before pivoting), the
   new-country 5-edit checklist with the `COUNTRY_INFERENCE_RULES` edit (apply `\b` consistently — and to
   the native name token, `magyar` ≠ `magyarország`), kennelCode collision discipline, the `<ext>` logo
   placeholder + magic-byte verify, the recently-active-evidence framing for generated sources, and the
   split adapter-verify / post-merge-seed runbook.
