# Cowork Handoff Retro — Shanghai H3 (🇨🇳 HashTracks' first mainland-China kennel, est. 1986) — 2026-06-11

Feedback from the Claude Code implementation session for the `2026-06-11-shh3-cn.md` handoff — a
**pure config-only `HARRIER_CENTRAL`** onboard (the adapter already exists; mirror Taiwan H3 / Lisbon
H3 / Hamburg H7) plus a **new China COUNTRY + Shanghai METRO** region (the full 5-edit `region.ts`
checklist; first mainland-China kennel). This was as clean as Porto: **zero new code** — seed +
region + one self-hosted logo. The live oracle held (1 upcoming event, the 2026-10-23 anniversary),
and the Lisbon/Porto HC coord work paid off a **third** time with no adapter change.

**PRs produced:**
- Onboarding (kennel/alias/source seed + China COUNTRY + Shanghai METRO region + self-hosted logo):
  [PR #2120](https://github.com/johnrclem/hashtracks-web/pull/2120) (merged). Two commits — seed/region
  base + a review-driven refinement (kennel-specific CJK alias + comment precision).
- Docs (this retro + run-log/queue → SHIPPED + new platform-notes HC subsection): this PR.

**Outcome:** Live at `https://www.hashtracks.xyz/kennels/shanghai-h3` — **1 canonical event**
(2026-10-23 15:00 "26th All China Nash Hash + 40th Shanghai Hash House Harriers Anniversary", status
CONFIRMED), Shanghai pin `31.2304, 121.4737`. Post-merge ran from the **worktree** on prod `.env` (the
main repo carried the user's uncommitted doc WIP on a stale base — pulling would have clobbered it; the
worktree tree == `origin/main`): `prisma db seed` (additive — kennel/5 aliases/source + China/Shanghai
regions + **Created 2** seasonal ScheduleRules / **Updated 388**, "No stale rules found"), then a
forced scrape via the prod `/api/cron/scrape/{id}` endpoint (Bearer `CRON_SECRET`) →
**eventsFound 1 / created 1 / 0 unmatched / 0 blocked / 0 errors**. Prod query confirmed the kennel,
source + `SourceKennel` link, both regions, the 2 active seasonal rules, and the merged event with a
clean re-geocoded Shanghai pin.

---

## The loop is working — previous retro fixes LANDED

1. **Config-only HC mirror of an existing source (Taiwan / Lisbon / Porto / Hamburg H7).**
   `publicKennelId` GUID filter + `defaultTitle:"Shanghai H3"` + `staleTitleAliases:["Placeholder event
   for SHH3"]`, `trustLevel:8`, `scrapeDays:365`, `kennelCodes:["shh3-cn"]`. Mirrored the Taiwan H3
   record line-for-line; **zero new adapter code.** The "mirror Taiwan exactly" instruction was spot-on.
2. **The Lisbon HC coord work made Shanghai's pin automatic — for the THIRD time (Lisbon → Porto →
   Shanghai).** The event's location is the coarse city string `"SHANGHAI"` and HC's `syncLat/syncLong`
   are its region-default pin (`placeName === resolvable`). `hcGeocodeFailed` caught it, dropped the
   coords (`dropCachedCoords:true`), and the merge re-geocoded "SHANGHAI" + China bias to the Shanghai
   centroid — **no new code.** The handoff predicted the pin would survive; the adapter's drop+re-geocode
   is the correct path and the final pin is identical either way.
3. **`upcomingOnly` intentionally OMITTED — matches every HC source.** HC `getEvents` is future-only and
   survives reconciliation; the handoff called it out and it was not added.
4. **Alias-collision discipline (Taiwan / Lisbon / Asunción).** Bare `shh3` is free as a *kennelCode*,
   but the bare **"SHH3" alias is already claimed by Singapore Harriets** (`sgharriets`). Because the
   resolver does kennelCode-exact-match before alias-match, a bare "SHH3" alias here would shadow
   Singapore Harriets — so the code is suffixed (`shh3-cn`) and the bare alias omitted (publish
   `SHH3-CN`). The mirror of the Taiwan `twh3`/Tidewater call, one tier softer (alias collision, not a
   kennelCode collision).
5. **New COUNTRY = the full 5-edit `region.ts` checklist incl. `COUNTRY_INFERENCE_RULES`.** China is the
   first mainland-China region (Taiwan + Hong Kong already exist separately), so all five edits were
   needed — and the inference rule is **load-bearing, not optional**: without it `inferCountry()` falls
   through to "USA" (the ONH3/WSH3 Gap-G failure). Rule placed AFTER the Hong Kong/Taiwan rules so those
   tokens resolve to their own regions first.
6. **Self-host the logo + confirm via magic bytes (self-host-unstable-logos).** Two candidates (HC blob
   PNG, site SVG); downloaded the HC blob, confirmed `\x89PNG` (400×400 RGBA), referenced
   `/kennel-logos/shh3-cn.png`. The handoff's literal `<ext>` placeholder (don't pre-fill) was right.
7. **Seasonal `scheduleRules` with disjoint BYMONTH (Budapest #2096).** Same weekday both seasons (Sun
   16:00 summer / 15:00 rest), so BYMONTH partitions the two rules (`6,7,8` vs the other nine months) to
   keep them distinct on the `(kennelId, rrule, source)` upsert key AND structurally opt the kennel out
   of `backfill-schedule-rules` Pass 2. Prod confirmed **exactly 2** HIGH-confidence rules, "No stale
   rules found".

---

## What the handoff got RIGHT (keep doing)

1. **The "recently-active onboard" framing was correct and load-bearing.** SHH3 does NOT post its weekly
   Sunday runs to Harrier Central (it coordinates via `shanghai-h3.com` / WeChat) — HC carries only the
   Oct-2026 anniversary. The handoff pre-empted the "1 event = broken scrape" misread with the
   weekly-cadence + 40th-anniversary evidence, and honestly flagged that the kennel page will show 1
   event until SHH3 posts more to HC. A non-empty result = success, exactly as written.
2. **The HC `getEvents` city-name sweep that FOUND this kennel.** The four top queued targets (Tulsa,
   Prague, Cape Town, Guadalajara) were all dead this run; Shanghai was discovered by turning the HC
   adapter into a live-kennel finder — replicate the `getEvents` token and POST `cityNames:"<City>"` over
   ~120 uncovered cities. A genuinely new, reusable discovery technique (now in `source-platform-notes.md`).
3. **Every verbatim oracle held live.** The 1 event, its 2026-10-23 15:00 start, the full anniversary
   title (trailing `|` and all), and the coords drop all reproduced via `adapter.fetch` from the local
   env. The "reconfirm from local env" flag was right (the Azure HC host is allowlist-blocked from the
   research sandbox; reachable locally).
4. **`hashCash` left blank, not guessed.** The homepage shows only ACNH-2026 *campout* pricing (¥588–688);
   the handoff correctly refused to seed those as weekly hash cash and flagged the field. No fabricated data.
5. **CJK is fine in seeds + inference.** `上海`/`中国`/`上海捷兔` are valid UTF-8 TS literals (Japan/HK/Taiwan
   already do this); the inference rule's bare CJK alternation matches the adjacent Taiwan rule's style.

---

## Handoff GAPS → research-prompt / process improvements (the actionable part)

### A. 🟡 The field-fill table's `hares` prediction was WRONG — but the merge pipeline saved it

The handoff's field-fill table asserted: *"hares: 'TBC' → HC adapter's `stripTba` nulls it."* That is
**incorrect** — `stripTba` only strips the exact token `"TBA"` (`/^tba$/i`), not "TBC". The HC
`GEOCODE_FAIL_SENTINELS` set *does* include `"tbc"`, but it is applied **only to the location field**
(`stripPlaceholderLocation` / `hcGeocodeFailed`), never to hares. So `adapter.fetch` emitted
`hares: "TBC"` verbatim.

It surfaced clean anyway because the **merge pipeline's own hare sanitization** dropped the "TBC"
placeholder — the canonical Event has `hares: null`, and the kennel page shows no hare line (not "Hares:
TBC"). Net: no user-visible defect, and **no shared-adapter change** was warranted for a config-only
onboard (the adapter author deliberately scoped the sentinels to location, where a fake *pin* is the
real harm).

> **Process note:** the field-fill table should describe *where* a placeholder is cleaned, not just
> *that* it is. "stripTba nulls TBC" conflated three different filters (`stripTba` = TBA-only;
> `GEOCODE_FAIL_SENTINELS` = location-only; merge = hares). For HC kennels with `hares: TBC/TBD`, expect
> the **merge** to clean it, not the adapter — and don't propose an adapter change to "fix" something
> that's already null downstream.

### B. 🟡 The seed's bare `"上海"` alias was a sibling-collision risk — caught in review

The handoff's ready-to-paste aliases included bare `"上海"` (just the city "Shanghai"). Claude review
flagged it: every future Shanghai-area kennel (DOGS H3, POSH, Full Moon, Taiping — all explicitly queued)
would equally match it and mis-route in the resolver. Replaced with the **kennel-specific** `"上海捷兔"`
(Shanghai Hash; 捷兔 is the standard Chinese for "hash", as in Taiwan's `台灣健龍捷兔` / `捷兔`), which is on
the logo and mirrors Tokyo's `東京ハッシュ`. Bare `上海` stays in `COUNTRY_INFERENCE_RULES` (where a
city-wide match to "China" is *correct*) but not as a kennel alias.

> **Process note:** for a first-in-region kennel that *opens* a metro with known siblings, the handoff's
> alias list should avoid the bare city/metro name — use the kennel-specific local-language name
> (`<City>捷兔` for Chinese hashes). Same lesson as the bare-`SHH3`/`TwH3`/`LH3` omissions, applied to CJK.

### C. 🟢 The bare-CJK inference-token review nit was a FALSE positive — declined with the file convention

Gemini (medium) wanted the CJK tokens wrapped: `(?:^|\W)(?:上海|中国)(?:\W|$)` instead of bare `上海|中国`.
Declined: the **adjacent Taiwan rule** (`region.ts`) already uses bare CJK alternatives
(`[台臺][灣北中南]|新北|高雄|桃園`) with no such wrappers — bare CJK is the file's established convention. `\b`
is ASCII-only and never bounded the CJK tokens anyway, and for *country* inference a substring match on
`上海`/`中国` is exactly what we want. Wrapping would only make this rule inconsistent with its neighbor for
zero behavioral gain. Replied with the convention reference and resolved the thread.

> **Process note:** mirrors the Porto bare-`porto` and Taiwan CJK calls — for `COUNTRY_INFERENCE_RULES`
> review nits, check the *adjacent rules' convention* and whether the proposed boundary even applies to
> the character class in question (ASCII `\b`/`\W` vs CJK), not just the abstract "add word boundaries"
> heuristic.

---

## Implementation / process learnings (loop context)

1. **🟢 Worktree discipline held this time — no cwd trap.** Every `Edit`/`Write` used the full
   worktree-prefixed path; `git status` in the worktree before staging was clean. The recurring
   main-repo-absolute-path trap (Porto/Vindobona/Bangkok) did not recur.
2. **🟢 Post-merge ran from the worktree, NOT the main repo — main had conflicting doc WIP on a stale
   base.** The main repo was on an old commit with the user's uncommitted edits to
   `run-log.md`/`target-queue.md`/`source-platform-notes.md` — and those same files had also changed on
   `origin/main` (the #2113 twh3 docs), so a `git pull` would have clobbered the WIP. Instead the
   worktree was fast-forwarded to `origin/main` (the merge commit is a descendant of the onboard branch,
   so `merge --ff-only` was clean), the prod `.env` copied in temporarily (gitignored, then removed), and
   seed + scrape ran from there. The main repo's prod `.env` was never touched. `npx prisma generate`
   once per fresh checkout. Node 25 (no `fnm` on PATH; 25 satisfies Prisma 7's "20+").
3. **🟢 Standalone tsx verify scripts need explicit `.env` loading.** The first prod-verify script
   connected to `localhost` (db `johnclem`) because importing `@/lib/db` does NOT auto-load `.env`
   outside Next.js — adding `import "dotenv/config"` fixed it (the script-env-loading memory). `prisma db
   seed` itself was fine (loads `.env` via `prisma.config.ts`'s `dotenv/config`).
4. **🟢 Triggered the scrape via the prod cron endpoint, not the admin UI.** `POST
   /api/cron/scrape/{sourceId}` with `Authorization: Bearer $CRON_SECRET` (the `verifyCronAuth` dual-auth
   fallback) drives a real scrape headlessly — no admin session needed. The prod canonical host is
   `www.hashtracks.xyz` (apex 308-redirects); `NEXT_PUBLIC_APP_URL` in the local `.env` is `localhost:3000`
   (a dev value — don't use it for prod calls).
5. **🟢 Live-verify proved END-TO-END before CI.** `adapter.fetch(source)` against the live HC API
   confirmed the 1-event count, the real title, the kennelTag resolution, AND the coord drop — before
   tsc/lint/test (8862 tests green). Then a prod query after the scrape confirmed the canonical Event +
   re-geocoded Shanghai pin + the null (sanitized) hares.
6. **🟢 All gates green, minimal churn.** SonarCloud Quality Gate passed (0 new issues / 0 hotspots),
   Codacy 0, Codex no issues, CodeRabbit no actionable comments. The two review-driven changes (CJK alias
   + comment) were a one-commit refinement; the Gemini CJK-boundary nit was declined with the convention.

---

## TL;DR for the research prompt + platform notes

1. **A config-only HC onboard is near-mechanical** — mirror the nearest sibling (Taiwan here): GUID
   `publicKennelId` + `defaultTitle` + `staleTitleAliases`, `upcomingOnly` OMITTED, single `kennelCodes`,
   `trustLevel:8`, `scrapeDays:365`. Zero new adapter code; the Lisbon coord/sentinel work handles the
   city-level default pin automatically (`placeName===resolvable` → drop → re-geocode) — proven 3× now.
2. **HC `getEvents` is a live-kennel finder.** When the queue runs dry, sweep `cityNames:"<City>"` over
   uncovered cities to surface config-only HC kennels. New `source-platform-notes.md` subsection.
3. **Field-fill tables must name the FILTER, not just the outcome.** "stripTba nulls TBC" was wrong
   (`stripTba` = TBA-only; sentinels = location-only; the **merge** cleans hares). For HC placeholder
   hares, expect the merge to null them — don't propose an adapter change.
4. **First-in-metro kennels: avoid the bare city/metro name as an alias.** Use the kennel-specific
   local-language name (`<City>捷兔` for Chinese hashes) so future siblings don't mis-route. Keep the bare
   city token in `COUNTRY_INFERENCE_RULES` (where city→country is correct), not in aliases.
5. **New COUNTRY = full 5-edit `region.ts` incl. `COUNTRY_INFERENCE_RULES`** (not optional — else "USA").
   Place a CJK-locale rule AFTER its neighbors (HK/Taiwan) and use bare CJK tokens to match the file
   convention; ASCII `\b`/`\W` boundaries don't apply to CJK.
6. **Keep:** the recently-active framing for a future-only feed, the verbatim-oracle capture + "reconfirm
   from local env" flag, the bare-shortcode alias-collision discipline (now extended to CJK), the
   seasonal disjoint-BYMONTH `scheduleRules`, and the worktree-path discipline.
