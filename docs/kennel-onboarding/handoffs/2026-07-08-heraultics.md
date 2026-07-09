# Onboarding Handoff — Heraultics H3 (Montpellier / Hérault, France) — 2026-07-08

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously:
> 1. Branch off a clean `main`: `onboard/heraultics-20260708`.
> 2. Apply the **Ready-to-paste seed** below (kennel + alias + source). Add the **Montpellier METRO**
>    region + map/inference edits in **Adapter notes → Region wiring** (France COUNTRY is already
>    seeded — Paris + Toulouse metros exist; this is a metro-only add). ⚠️ **Lyon H3**
>    (`handoffs/2026-07-07-lh3-fr.md`) may land first and add a Lyon metro just above where Montpellier
>    goes — insert Montpellier after whatever France metros exist; the edits are additive.
> 3. Configure the **config-only `HARRIER_CENTRAL`** source exactly as in **Adapter notes** — no new
>    adapter code (mirror the Bandung HC source row in `prisma/seed-data/sources.ts`).
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md` — call
>    `adapter.fetch(source)` via a throwaway `npx tsx -e '…'`. Validate: dates UTC-noon, `startTime`
>    "HH:MM", `kennelTag` resolves to `heraultics` with no unmatched. The HC `getEvents` API is
>    future-only, so expect **~1 upcoming (#12 "Return to Agde", 2026-09-26)**. **DO NOT run
>    `npx prisma db seed` here.**
> 5. Apply the **Historical backfill** one-shot (`scripts/backfill-heraultics-history.ts`) — **6 counted
>    past runs** (#6–#11, dropping the uncounted #10 slot) via `hashruns.org/api/global-runs?isFuture=0`
>    (see **Historical backfill** for the exact scrubs). Worth it — otherwise the page shows a single
>    upcoming run 80 days out with no recent history.
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR carrying the metadata, live-verification results, and the deep-dive checklist.
> 8. **Post-merge runbook (after the PR merges):**
>    - `git checkout main && git pull`
>    - Verify each expected file landed on `main` (`git log -1 -- <file>` for the seed files,
>      `src/lib/region.ts`, and `scripts/backfill-heraultics-history.ts`). Recover any dropped by squash-merge.
>    - `eval "$(fnm env)" && fnm use 20`
>    - `npx prisma db seed` (additive; seeds the kennel/alias/source + updates `Source.config`)
>    - Run the backfill script once, then trigger a scrape from `/admin/sources` to publish events.
>    - Spot-check `hashtracks.xyz/kennels/heraultics-h3` for ~7 events (6 backfilled + upcoming #12).

## Summary
- Type: **full onboard**
- Adapter: **HARRIER_CENTRAL** (config-only — adapter exists at `src/adapters/harrier-central/adapter.ts` & feed verified live)
- Effort estimate: **config-only source + ~3 `region.ts` metro edits + a ~6-row one-shot backfill script**. No new adapter code.
- One-line: Heraultics H3 — a low-volume but genuinely active Hérault (Montpellier / Agde / Sète) kennel, 3rd–4th French metro on HashTracks after Paris + Toulouse (+ Lyon pending); clean config-only HC onboard with a small 6-run backfill.

## Dedup result
- Kennel in seed: **no** (grep `heraultics`/`montpellier`/`agde`/`herault` in `prisma/seed-data/kennels.ts` → none)
- Source in seed: **no** (grep in `prisma/seed-data/sources.ts` → none)
- Live sitemap dedup: **confirmed NOT live** — read `hashtracks.xyz/sitemap.xml` via Chrome MCP 2026-07-08, **480 slugs**; no `heraultics`, no `heraul`/`agde`/`montpel`/`sete`/`herault` fragment. `toulouse-h3` is present (confirms France COUNTRY seeded); no `lyon` slug (Lyon handed-off but not yet shipped).
- Pre-onboarding admin-event check: kennel not live, no partial page → no admin-seeded `Event` rows to dedup/purge (Claude Code: confirm `/kennels/heraultics-h3` 404 at build).
- Decision: **full onboard**
- kennelCode: `heraultics` (collision check: grep-clean in `kennels.ts` + `aliases.ts`; no existing `heraultics`/`herault` code or alias)

## Live source verification  ✅ (verified live via Chrome MCP page-context fetch of `hashruns.org/api/global-runs`, 2026-07-08)
- Source: **HARRIER_CENTRAL** — `publicKennelId: dc7dc54b-422b-4c5b-b9fd-b29f265cef8a` (HC `KennelSlug: Heraultics`, `KennelShortName: Heraultics`, `KennelName: Heraultics H3`, `KennelIANATimezone: Europe/Berlin` — 🔴 **HC tz quirk; the kennel is in France → use `Europe/Paris`** for the Montpellier metro).
- Feed: `hashruns.org/api/global-runs?isFuture=1` (wrapper `{ totalMatchingEvents, runs }`) + `isFuture=0` windows. **⚠️ Claude Code must confirm** the Azure adapter endpoint (`harriercentralpublicapi.azurewebsites.net/api/PortalApi/` + `publicKennelId`) returns the same upcoming event at build (the live adapter uses the Azure `getEvents` path; the research sandbox can't resolve the Azure host, so the sample was captured from `hashruns.org`).
- Events seen: **1 upcoming + 7 past rows (6 counted after dropping 1 `IsCountedRun=0` slot)**.
- Date range: **2024-04-01 (#6) … 2026-09-26 (#12 upcoming)**. Most recent **counted** past run **#11 2026-04-19** (~80 days before today) + a **confirmed upcoming #12** with hares assigned → source clearly live/active.
- **Recently-active rationale:** This is NOT a "0 upcoming" case — there is 1 confirmed future run (#12 "Return to Agde", 2026-09-26, hares "Little Brother + John Cleese"). The kennel is sporadic (blog literally says "running **sporadically**"); ~quarterly with gaps of 1–9 months. Last counted run #11 was ~80 days ago and a next run is posted → active, onboard normally (**handed-off, not blocked**).
- **Source-count parity:** HC UI is future-only; `isFuture=1` returns 1 upcoming for this kennel and the adapter returns the same 1 → parity OK (N/A for a future-only feed). Full HC history reachable via `isFuture=0` = 7 rows (#6–#11, no truncation; the kennel joined HC at run #6 — runs #1–#5 [2019–2021] exist only on the blog, see History depth).
- Sample events (VERBATIM from `EventName` / `EventStartDatetime`; Heraultics uses real theme titles, kept verbatim):
  1. **#12** — "Return to Agde" — 2026-09-26 14:00 — hares "Little Brother + John Cleese" — Agde — €5 — coords 43.3059, 3.4711 *(upcoming; real Agde venue)*
  2. **#11** — "Run #11 Sparkling Sunday hangover run in Carcassonne" — 2026-04-19 **10:30** — hares "Cheesy Lollipop, I Like Your Boobs" — Tribe Hotel Carcassonne — **€10** (special co-host) — coords 43.210, 2.358 *(co-hared with Toulouse H3 for a Diva H3 weekend — see sibling sweep)*
  3. **#10** — "Vikings on a vessel again..." — 2026-03-05 **22:30** — hares "Horny tail, John Cleese" — M/S Viking Glory (ferry Stockholm↔Turku) — free — coords 59.469, 19.368 *(real Baltic-ferry away-run; 22:30 is genuine per blog, NOT a typo)*
  4. **#9** — "Héraultics H3 Run #9 - Montpellier" — 2025-06-08 14:00 — hares "Hungjury" — Tram stop "Via Domitia", Montpellier — €5 — coords 43.647, 3.930
  5. **#6** — "Héraultics H3 - Run #6 - Sète Viking Invasion" — 2024-04-01 (HC stored **00:30** → blog says **12:30**, see scrubs) — hares "John Cleese" — Sète train station — coords 43.412, 3.696
- History depth / pagination: **7 HC rows (#6–#11)** reachable via `isFuture=0` 6-month windows back to 2024-04-01 (`isFuture=0` REQUIRES `minEventDate`+`maxEventDate`; `publicKennelId` is IGNORED server-side → filter client-side by `PublicKennelId`; dedup by `EventNumber`+`EventStartDatetime`). Coverage = the kennel's HC-join date forward; the blog (`heraulticsh3.blogspot.com`) additionally holds **runs #1–#5 (Dec 2019 – 2021)** — see **Historical backfill → optional deeper blog backfill**.
- Coord sanity: **all 7 HC rows carry lat/lng; every coord is a distinct REAL venue — NO default-pin / duplicate-coord trap.** 🔴 **Do NOT apply a blanket France bounding-box scrub for this kennel** (unlike Barbados/Bandung): two coords are legitimately foreign because they were **real away-runs** — #7 Helgoland, Germany (`54.188, 7.885`, real) and #10 Baltic ferry (`59.469, 19.368`, real). A France-bbox filter would wrongly drop these true pins. Keep coords verbatim; spot-check confirmed each is the actual venue.
- End times: none in the feed (no `EventEndDatetime`) → `endTime` undefined.
- Currency: HC `global-runs` carries **no currency field** (`EventPriceForMembers`=5 only). **EUR (€5) is CONFIRMED**, not merely inferred — the blog says "**Hashcash : 5€**" verbatim on Runs #8/#9/#10. No inference risk.
- Notes: config-only HC; mirror the Bandung/Lyon/BEER H3 rows. `Hares` field is clean here (real hash names; no venue-bleed like Lyon #25). Low event volume overall (12 runs in ~6 years) — expected for a sporadic kennel.
- **Field-fill assertion table** (sampled the 5 rows above + full 7-run HC past set):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 7 / 7 | HC `EventName` verbatim (real themes); `defaultTitle: "Heraultics H3"` synthesizes only for empty/placeholder names |
  | `startTime` | 7 / 7 | from `EventStartDatetime` "HH:MM" — ⚠️ **#6 clerical typo** (`00:30` → blog `12:30`); **#10 `22:30` is REAL** (ferry) — see Historical backfill scrubs |
  | `endTime` | 0 / 7 | not in feed — accept absence |
  | `location` (venue) | 7 / 7 | `LocationOneLineDesc` (all real venue text; no placeholder sentinels present) |
  | `locationStreet` | ~3 / 7 | some rows carry a street (`25 rue d'Embonne, 34300 Agde`); adapter composes from HC location parts |
  | `locationUrl` (Maps) | 0 / 7 | not in HC feed (blog has `maps.app.goo.gl` links; not worth a second source) |
  | `hares` | 7 / 7 | `Hares` — clean real names; no venue-bleed. Keep verbatim |
  | `cost` | 7 / 7 | kennel default €5; per-event overrides exist (#11 €10, #10 free) — kennel `hashCash` covers the default, HC adapter emits no `cost` |
  | `description` | ~6 / 7 | 🔴 **OMIT — do not populate from HC `EventDescription`** (PII-risk rule; live HC adapter emits no `description`) |
  | `trailLengthText` | 0 / 7 | not in feed |
  | `coords` (lat/lng) | 7 / 7 | `Latitude`/`Longitude` — all real; keep verbatim (2 legit-foreign away-runs; **no bbox scrub**) |

## Kennel metadata (deep-dive complete)
- fullName: **Heraultics Hash House Harriers** (source: blog `heraulticsh3.blogspot.com` title / og:title; HC `KennelName`="Heraultics H3")
- shortName: **Heraultics H3**  → slug `heraultics-h3` (pure ASCII — no accent in the shortName, so **no explicit `slug:` override needed**; the accented "Héraultics" form is carried as an alias)
- region: **Montpellier** · country: **France**  (Hérault département; the kennel runs across Montpellier / Agde / Sète — Montpellier is the metro anchor)
- aliases: `["Heraultics H3", "Héraultics H3", "Heraultics", "Heraultics Hash House Harriers"]`  (no bare short-acronym collision — grep-clean)
- website: **https://heraulticsh3.blogspot.com/** (blogspot.com = known platform, no DNS check needed; live, latest post Run #11 2026-04)
- facebook: **https://www.facebook.com/HeraulticsH3/** (source: blog footer FB button + WebSearch)
- instagram / twitter / discord: **none found** → leave blank
- schedule: **sporadic** — no fixed cadence; mostly **weekend afternoons ~14:00** (blog: "running **sporadically**"). Kept as flat fallback fields only; **NOT a clean multi-pattern → no `scheduleRules`**. (source: blog run posts "When: … at 14:00/15:00" + HC datetimes)
- foundedYear: **2020** (source: blog "Run #1 - Run report" dated Jan 2020; blog archive's earliest post is Dec 2019 = club announcement → founding straddles late-2019/early-2020, first run Jan 2020). Note the discrepancy in the PR; 2020 = first-run year.
- hashCash: **"5€"** (source: heraulticsh3.blogspot.com Runs #8/#9/#10 posts — "Hashcash : 5€"; matches HC `EventPriceForMembers`=5. Per-event specials vary: #11 10€, #10 free — those are `Event.cost`, not the kennel default)
- dogFriendly / walkersWelcome: unknown → leave default/blank (not stated; note #6 was "rather walking" but that's one run, not policy)
- logoUrl: **⚠️ self-host** — HC blob `https://harriercentral.blob.core.windows.net/harrier/Heraultics%20H3.png` (tokenizable HC CDN). Download to `public/kennel-logos/heraultics.<ext>` and confirm the real extension by **magic bytes**, NOT the `.png` in the URL (HC blobs have served WebP/AVIF elsewhere — Belgrade `.avif`). Use a literal `<ext>` placeholder until confirmed.
- description: **"We are a drinking club with a running problem, running sporadically in the south of France Hérault region, through mountains, vineyards, valleys, to the beach!"** (source: heraulticsh3.blogspot.com meta-description / homepage verbatim)
- lat/lng (kennel): Montpellier metro centroid ≈ 43.6108, 3.8767 (see Region wiring)

### Sibling-kennel sweep
Swept the `hashruns.org/api/global-runs` enumeration for other kennels in Hérault / Montpellier / Agde / Sète: **only Heraultics H3** (`dc7dc54b…`) surfaced for the area. #11 was **co-hared with Toulouse H3** (already live at `/kennels/toulouse-h3`) for a Diva H3 weekend in Carcassonne — that's a one-off joint trail on **Heraultics'** run number (#11), not a Toulouse-hosted event and not a sibling to co-map (Toulouse H3 is its own live kennel; Carcassonne/Diva H3 are not queued targets). → **single-kennel source, no siblings to co-map.** (No Montpellier Full Moon / Bike / sister kennel on HC.)

## Historical backfill
- Available: **6 counted runs (#6 2024-04-01 → #11 2026-04-19)** on HC — fields: date, title (verbatim theme), hares (clean), location, coords (all 6), cost (per-event). Source: `hashruns.org/api/global-runs?isFuture=0` (PascalCase rows; filter client-side by `PublicKennelId`).
- Plan: **one-shot `scripts/backfill-heraultics-history.ts`** (worth it — otherwise the page shows a single upcoming run 80 days out). Follow the **frozen curated-dataset + dumb loader** pattern (freeze `scripts/data/heraultics-history.json`, commit the loader, NOT the parser). Bind to the live HC source row and set `config.upcomingOnly: true`.
- 🔴 **Curated-backfill scrubs (fix value errors; preserve real quirks):**
  1. **Drop the uncounted #10 slot.** There are TWO `#10` rows: `2025-09-07` (`IsCountedRun=0`, name "…Montpellier Love Beer Festival", blog title literally "(Cancelled)") and `2026-03-05` (`IsCountedRun=1`, "Vikings on a vessel again"). **Drop the 2025-09-07 `IsCountedRun=0` row** (cancelled slot) → the real #10 is 2026-03-05; this also resolves the apparent #10 duplicate for free (matches the Algarve/Bandung drop-uncounted rule).
  2. **#6 time typo → normalize to 12:30 (blog-confirmed).** HC stored `2024-04-01T00:30:00` (12h AM/PM typo; GMT field agrees it's off). The **blog** says "When: Monday April 1. 2024 at **12:30**" → set `startTime: "12:30"` (blog ground truth, same class as Bandung's `02:30`→`14:30` GMT-confirmed fix). Do NOT drop it to undefined — you have the real time.
  3. **#10 `22:30` is REAL — KEEP it.** The blog confirms "When: March 5th 2026 - **22:30**" (a genuine late ferry event). This is an out-of-`06:00–20:00`-range time but **not** a typo — do NOT apply the Barbados hour-gate blindly here; keep `22:30`.
  4. **Coords — keep all verbatim; NO France bbox scrub.** All 6 coords are real distinct venues. #7 Helgoland (`54.188, 7.885`, Germany) and #10 Baltic ferry (`59.469, 19.368`) are **legit away-runs** — dropping them via a country-bbox filter would erase true pins. No default-pin trap exists here, so no scrub is needed.
  5. **Run-number continuity:** #6→#11 monotonic once the uncounted #10 is dropped — no renumbering.
  6. **Omit `description`** (PII rule) and **omit `cost`** (HC adapter emits none; kennel `hashCash` €5 covers the default). If you choose to store per-event `cost`, use `EventPriceForMembers` (#11 €10, #10 €0) — optional.
- Frozen-dataset validation checklist before shipping: PII scrub (`@`/phones — the HC `Hares` here are clean hash names; do not copy `EventDescription`), run-number monotonicity (OK after #10-cancelled drop), gap sanity (sporadic 1–9-month gaps are REAL for this kennel — do not flag as misparse; dates are exact from HC), field bleed (`:` in hares/location — none here).
- 🟢 **Optional deeper blog backfill (runs #1–#5, 2019–2021) — flag, don't block.** The blog archive holds earlier posts: 2019 (1, Dec), 2020 (6, incl. Run #1 report Jan 2020 + Run #2 Agde postponed [COVID]), 2021 (2). These predate the HC join (#6). It's **~5 runs of Blogger-hosted prose** (structured `When/Where/Hare/Hashcash` labels in the newer posts, looser in 2020). Worth a *second* pass only if we want full lifetime history; **not required for launch** and out of scope for this handoff's 6-row HC backfill. If pursued, use `fetchBloggerPosts()` (`src/adapters/blogger-api.ts`) against `heraulticsh3.blogspot.com` — but confirm each post is a real *run* (some 2020 posts are "postponed"/report-only).

## Ready-to-paste seed

```ts
// kennels.ts — Kennel[] (array of objects). Insert near the other France kennels.
{
  kennelCode: "heraultics",
  shortName: "Heraultics H3",
  fullName: "Heraultics Hash House Harriers",
  region: "Montpellier",
  country: "France",
  website: "https://heraulticsh3.blogspot.com/",
  facebookUrl: "https://www.facebook.com/HeraulticsH3/",
  foundedYear: 2020,
  hashCash: "5€",
  // scheduleDayOfWeek/scheduleTime kept as fallback; no scheduleRules (sporadic — no fixed cadence).
  scheduleDayOfWeek: "Saturday",
  scheduleTime: "2:00 PM", // 🔴 12-hr in kennels.ts; RawEventData.startTime stays 24-hr "14:00".
  scheduleFrequency: "Sporadic", // free-form label; the kennel runs irregularly (~quarterly). Adjust if the field is enum-constrained.
  description:
    "We are a drinking club with a running problem, running sporadically in the south of France Hérault region, through mountains, vineyards, valleys, to the beach!",
  logoUrl: "/kennel-logos/heraultics.<ext>", // ⚠️ self-host from HC blob; confirm <ext> by magic bytes
  // lat/lng optional — Montpellier metro centroid supplies the fallback
}

// aliases.ts — Record<string, string[]>  (key = kennelCode, NOT slug).
"heraultics": ["Heraultics H3", "Héraultics H3", "Heraultics", "Heraultics Hash House Harriers"],

// sources.ts — Source[] (array). Mirror the Bandung/Lyon HC row.
{
  name: "Heraultics H3 Harrier Central",
  url: "https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/",
  type: "HARRIER_CENTRAL" as const,
  trustLevel: 8,
  scrapeFreq: "daily",
  scrapeDays: 365,
  config: {
    publicKennelId: "dc7dc54b-422b-4c5b-b9fd-b29f265cef8a",
    defaultKennelTag: "heraultics",
    // Heraultics names events with real themes ("Run #N - <theme>"), kept verbatim.
    // defaultTitle synthesizes "Heraultics H3 #N" only for empty/placeholder names (mirrors Bandung).
    defaultTitle: "Heraultics H3",
    staleTitleAliases: ["Placeholder event for Heraultics"],
    // upcomingOnly:true — the HC getEvents API is future-only and this source owns a 6-run historical
    // backfill (scripts/backfill-heraultics-history.ts); without this guard reconcile.ts would
    // false-CANCEL the aged past runs as they age off the 365-day window (Bandung #2340 contract).
    upcomingOnly: true,
  },
  kennelCodes: ["heraultics"],
}
```

## Adapter notes / new-scraper plan
**Config-only — no new adapter code.** `HARRIER_CENTRAL` is registered in `src/adapters/registry.ts`
(`src/adapters/harrier-central/adapter.ts`). The source row above is the entire integration; verify
against the live Azure endpoint at build (step 4).

### Region wiring — add **Montpellier METRO** under the existing France COUNTRY (`src/lib/region.ts`)
France COUNTRY + Paris + Toulouse metros already exist (`region.ts:1906–1940`), so this is a
metro-only add — **3 edits** (⚠️ line numbers are pre-Lyon; if Lyon H3 ships first it inserts a Lyon
metro nearby — insert Montpellier adjacent to the existing France metros, order doesn't matter):

1. **`REGION_SEED_DATA`** — add a Montpellier METRO after Toulouse (~line 1940). Metro = lighter shade
   `-100`, France pin `#3b82f6` (mirror the Toulouse row exactly; **no `level` field** — metros omit it):
   ```ts
   {
     name: "Montpellier",
     country: "France",
     timezone: "Europe/Paris", // 🔴 NOT HC's "Europe/Berlin" quirk
     abbrev: "MPL",
     colorClasses: "bg-blue-100 text-blue-700",
     pinColor: "#3b82f6",
     centroidLat: 43.6108,
     centroidLng: 3.8767,
     aliases: ["Montpellier, France", "Hérault"],
   },
   ```
2. **`STATE_GROUP_MAP`** — add `"Montpellier": "France",` in the France block (after `"Toulouse": "France",`, ~line 4191).
3. **`COUNTRY_GROUP_MAP`** — add `"Montpellier": "France",` in the France block (after `"France": "France",`, ~line 4433).

`COUNTRY_CODE_TO_NAME` already has `FR: "France"` (~line 4586) — no edit.

🟡 **`COUNTRY_INFERENCE_RULES` (~line 3908) — optional, RECOMMENDED with a disambiguation test.**
The France rule is currently `/\b(france|paris|ile-de-france|toulouse)\b|(?:^|\W)île-de-france\b/`.
Adding `montpellier|herault` keeps parity with the existing city-name tokens and catches bare
"Heraultics"/"Hérault"/"Montpellier" research input. Both are **unambiguously French**:
- `montpellier` (double-L) does NOT collide with US **Montpelier** (single-L, VT/ID/OH) — different spelling.
- `herault` is the French département; no US place-name collision.
```ts
[/\b(france|paris|ile-de-france|toulouse|montpellier|herault)\b|(?:^|\W)(?:île-de-france|hérault)\b/, "France"],
```
**Add a disambiguation test** (mirror the Victoria-BC/Australia one): assert `inferCountry("Montpellier, France")` → `"France"` AND that `inferCountry("Montpelier, Vermont")` does **NOT** route to France (single-L guard). The seed kennel carries explicit `country: "France"`, so inference only affects the *research* path — omit these tokens if Claude Code prefers the strict reading (`france` still catches "City, Country" input); note the choice in the PR.

**⚠️ Claude Code: verify before writing real code.** Any snippet here is illustrative; the live repo is
authoritative. Confirm against current types/imports:
- `RawEventData` field names — `kennelTags` is `string[]` (NOT `kennelTag`); `walkersWelcome` (NOT `walkerFriendly`).
- The backfill script uses `safeFetch` (NOT raw `fetch`) if it hits HC live at build; prefer freezing a
  curated `scripts/data/heraultics-history.json` and committing a dumb loader (per H7 pattern) — don't commit the parser.
- Dates → UTC noon; `startTime` "HH:MM" 24-hr; `cuid()` IDs.
- `staleTitleAliases` won't fire (Heraultics uses real theme names) — it's cheap defensive insurance only.

## Deep-dive checklist (nothing deferred)
- [x] logo (HC blob → flag self-host + magic-byte ext)  [x] foundedYear (2020, blog Run #1)  [x] socials (FB confirmed; IG/X/Discord none)  [x] schedule (sporadic ~Sat 14:00; flat fields, no scheduleRules)  [x] hashCash (€5, blog-confirmed verbatim)
- [x] description (blog meta verbatim)  [x] source live-verified (HC feed, 1 upcoming + 7 past)  [x] history depth (6 counted HC runs #6–#11; blog holds #1–#5, flagged optional)
- [x] coord sanity (all real; 2 legit-foreign away-runs; NO bbox scrub)  [x] end times (none)  [x] kennelCode collision-checked (`heraultics` clear)  [x] kennelCodes source guard set (`["heraultics"]`)

## Implementation gotchas (for Claude Code — repo knowledge)
- **`config.upcomingOnly: true` is REQUIRED** (not optional) because this source owns a 6-run backfill
  AND the HC `getEvents` path is future-only → without it `reconcile.ts` false-CANCELs the aged past
  runs as they slide off the 365-day timeMin window (identical to Bandung #2340 / Lyon / BEER H3 contract).
- **Self-host the HC logo** into `public/kennel-logos/heraultics.<ext>`; confirm the ext by magic bytes
  (`file public/kennel-logos/heraultics` — `RIFF…WEBP`, `\x89PNG`, `ftyp…avif`, `\xff\xd8`=JPEG). Never
  pre-fill `.png` from the blob URL.
- **`friendlyKennelName` check unnecessary** — `shortName: "Heraultics H3"` is >4 chars, so merge's title
  synthesis short-circuits to it cleanly (only relevant for an empty-theme run, and every run has a theme).
- **Backfill scrubs** — see Historical backfill: drop the uncounted #10 (2025-09-07 `IsCountedRun=0`);
  normalize #6 `00:30`→`12:30` (blog-confirmed); KEEP #10 ferry `22:30` (real, blog-confirmed);
  keep all coords (NO France bbox scrub — 2 legit-foreign away-runs). Dry-run the frozen JSON through
  merge scanning for same-`(kennel,date,startTime)` collisions + implausible times before trusting it.
- **`isFuture=0` mechanics** — REQUIRES `minEventDate`+`maxEventDate` (400 without), `publicKennelId`
  ignored server-side (filter client-side by `PublicKennelId`), rows PascalCase, dedup by
  `EventNumber`+`EventStartDatetime`, page ≤6-month windows. Response is `{ totalMatchingEvents, runs }`
  (read `.runs`; code defensively `raw.runs ?? (Array.isArray(raw) ? raw : [])`).
- **Do NOT populate `description` from HC `EventDescription`** (PII rule; live HC adapter emits none).

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is the brief._
