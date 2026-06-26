# Cowork Handoff Retro — Bandung H3 / BHHH2 (🇮🇩 Indonesia's 2nd metro after Bali, est. 1984) — 2026-06-24

Feedback from the Claude Code implementation session for the `2026-06-24-bandung-h3.md` handoff — a
**pure config-only `HARRIER_CENTRAL`** onboard (mirror Taiwan H3 / Shanghai H3 / Lisbon / Hamburg H7) plus a
new **Bandung METRO** under the existing Indonesia COUNTRY **and a 55-run historical backfill**. The
config-only core was as clean as Shanghai — zero new adapter code, the live oracle held (1 upcoming #2309),
and the Lisbon coord/sentinel work carried again. But this onboard **also loaded a backfill**, and that
combination exposed three handoff assumptions that don't survive contact with the merge/reconcile pipeline.
The four review bots (Codex, CodeRabbit, claude[bot], plus SonarCloud/Codacy) each earned their keep.

**PRs produced:**
- Onboarding (kennel/alias/source seed + Bandung METRO region + self-hosted logo + backfill script/data):
  [PR #2340](https://github.com/johnrclem/hashtracks-web/pull/2340) (merged). **Five commits** — onboard base,
  a `/simplify` comment tighten, then three review-driven fixes (02:30 time typo, #2292 duplicate, dead
  website).
- Docs (this retro + run-log/queue → SHIPPED + the HC platform-notes correction): this PR.

**Outcome:** Live at `https://www.hashtracks.xyz/kennels/bandung-h3` — **56 canonical events** (1 upcoming
**#2309 Fri 2026-06-26 14:30** "Gd. BHHH2 Panorama, Lembang" + 55 historical back to **#2253 2025-06-13**),
all CONFIRMED, real venue pins. Post-merge ran from the **main repo** (clean this time — no doc-WIP conflict,
unlike Shanghai): `prisma db seed` (additive — kennel/4 aliases/source + Bandung region, **Created 1 /
Updated 435**, "No stale rules found"), then `BACKFILL_APPLY=1 …backfill-bandung-h3-history.ts` (**created=55,
blocked=0, errors=0**), then a one-shot `scrapeSource(id,{force:true})` (**eventsFound 1 / created 1 / 0
errors**). Prod `psql` confirmed: 56 events, the formerly-colliding **#2291@02-20 + #2292@02-27 distinct**
with **zero duplicate dates**, start times **54×14:30 + 1×13:30** (no 02:30), website empty.

---

## The loop is working — previous retro fixes LANDED

1. **Config-only HC mirror of an existing source (Taiwan / Shanghai / Lisbon / Hamburg H7).** `publicKennelId`
   GUID filter + `defaultTitle:"Bandung H3"` + `staleTitleAliases:["Placeholder event for BHHH2"]`,
   `trustLevel:8`, `scrapeDays:365`, single `kennelCodes`. Mirrored the Taiwan/Shanghai records; **zero new
   adapter code.** `adapter.fetch(source)` from local env returned the verbatim oracle (#2309, 2026-06-26,
   `startTime:"14:30"`, `kennelTag:bandung-h3`, 0 errors) before any seed edit.
2. **The HC `Asia/Bangkok` timezone quirk is a genuine no-op — confirmed in code.** The handoff flagged HC's
   `KennelIANATimezone:"Asia/Bangkok"` (wrong for Bandung) as "harmless because both are UTC+7." Reading
   `adapter.ts:156-158`: the adapter extracts the literal local time from `eventStartDatetime` via
   slice/regex and **never reads the timezone field at all** — so the quirk has zero effect on the stored UTC
   regardless of the offset. Set the **region** zone to `Asia/Jakarta` (correct city zone), as instructed.
3. **Alias-collision discipline (Shanghai/Taiwan/Asunción).** `BHHH2` (with the 2) is free; the handoff
   correctly omitted bare `BHHH` (→ `bh4` Big Hump) and `BH2` (→ `bali-hash-2`). Grep-verified clean.
4. **Self-host the logo + magic-byte the extension.** HC blob served genuine AVIF (`ftypavif`); `sips`
   converted to PNG (512×512) at `/kennel-logos/bandung-h3.png` to match the all-PNG convention. The literal
   `<ext>` placeholder (don't pre-fill) was right — it was NOT `.png` at the source.
5. **METRO under an existing COUNTRY = the 4 metro-level `region.ts` edits.** REGION_SEED_DATA record
   (`Asia/Jakarta`, teal-400 `#2dd4bf` distinct from Bali's `#14b8a6`, centroid -6.9175/107.6191) +
   `STATE_GROUP_MAP` + `COUNTRY_GROUP_MAP` + extend `COUNTRY_INFERENCE_RULES` with `bandung|lembang`. Indonesia
   COUNTRY + `COUNTRY_CODE_TO_NAME` already existed (do NOT re-add) — exactly as the handoff scoped.

---

## What the handoff got RIGHT (keep doing)

1. **The recently-active framing for a future-only feed.** HC `getEvents` carries one forward run at a time;
   the handoff pre-empted the "1 event = broken scrape" misread with the weekly-Friday cadence evidence
   (#2308→#2309 = 7 days). A single upcoming event = success.
2. **Metadata sourced, not guessed.** foundedYear **1984** (About page "We started in 1984"), hashCash
   **"Rp25,000"** (About + HC `EventPriceForMembers/NonMembers`), walkersWelcome **true** (3 course lengths).
   IG `@bhhhplus` correctly **not** attributed (it's the sibling BHHH+, not BHHH2).
3. **The structural quirks that ARE real were correctly flagged.** Gaps at run #2273/#2289 and the "Run 2231"
   title typo on event #2301 are faithful facts about HC's records — preserved verbatim, as instructed.
4. **HC `Hares` is unreliable for this kennel — omit it.** The structured `Hares` field is mostly empty
   (hares live in the description) and elsewhere carries location-bleed. The handoff said ignore it; the
   backfill omits it entirely. Correct.

---

## Handoff GAPS → research-prompt / process improvements (the actionable part)

### A. 🔴 `upcomingOnly` must be **TRUE**, not omitted, when an HC source ALSO carries a backfill

The handoff said `upcomingOnly` **OMITTED** ("the no-backfill HC convention"). That is correct for a *live-only*
HC kennel — but **wrong the moment the same source owns a historical backfill.** `reconcile.ts:144` builds its
window as `timeMin = upcomingOnly ? now : now - days*86_400_000`, and the candidate query (`:162-168`) selects
by `kennelId` + `date ∈ [timeMin, timeMax]` with **no sourceId filter**. With `upcomingOnly` omitted and
`scrapeDays:365`, every backfilled run inside the last year is a cancellation candidate; the future-only HC
adapter never re-scrapes them, so they're orphaned (`:251`) and CANCELLED as sole-source (`:276-285`). BHHH2
runs weekly → **~52 of the 55 backfilled runs would be nuked on the first post-merge scrape.**

The fix is established: every future-only adapter that ships a one-shot backfill sets `upcomingOnly:true`
(Asunción `sources.ts`, New Taipei `nth3-tw`). So this source does too. Caught **before** shipping by reading
reconcile.ts during planning, not by a bot.

> **Process note (→ research prompt + platform notes):** a handoff that specs BOTH a future-only HC source
> AND a backfill must set `upcomingOnly:true`, NOT omit it. The "omit per HC convention" line is only valid
> for live-only HC kennels. Whenever a backfill binds to a future-only adapter's source, `upcomingOnly:true`
> is a hard requirement, not a style choice.

### B. 🔴 Curated backfill: distinguish **structural quirks (preserve)** from **value errors that corrupt on load (fix)**

The handoff said *"honor the source-data quirks faithfully — do NOT 'fix'"* and lumped together: reused run#
2292, gaps 2273/2289, and Hares bleed. Two of those weren't faithful-to-preserve — they were broken data that
two different bots correctly flagged:

- **🔴 The #2292 "reuse" is a mis-dated duplicate that corrupts #2291 (Codex, P2).** HC carries #2292 on BOTH
  2026-02-20 *and* 2026-02-27 with the **same venue** ("Gd. BHHH2, Panorama, Lembang"), while the real 02-20
  run is **#2291** (distinct venue "Kapulaga Grand Panorama"). In one `processRawEvents` batch the #2292@02-20
  row hits the same-day match (`merge.ts:1463-1473`, `looksLikeSameEvent` true via shared `startTime:"14:30"`)
  and **folds into #2291's canonical** instead of creating its own — mislabeling #2291 and leaving a duplicate
  #2292. It's a duplicate, not a "reuse." Dropped the 02-20 copy → true weekly schedule (#2291@02-20,
  #2292@02-27); 56→55 rows, zero same-date collisions. *Preserving this "quirk" was literally impossible —
  the merge can't hold #2291 and the #2292@02-20 duplicate on the same `(kennel,date)`.*
- **🔴 Three `02:30` start times are a clerical AM/PM typo (CodeRabbit, Major).** Runs #2283/#2286/#2288 were
  entered at `02:30` local — both HC datetime fields agree (GMT = local − 7h), so it's baked into HC, but it's
  **exactly 12h off** `14:30`, on three normal weekly Fridays, contradicting the kennel's own #2309 description
  ("Run Start: 2:30pm sharp local time"), the seed schedule, and all 50+ sibling rows. Preserving it ships
  visibly-wrong **2:30 AM** cards. Normalized → `14:30`. (Left the one `13:30` Independence Day special — only
  1h off, plausibly a genuine holiday start.)

The two AI reviewers genuinely **disagreed**: claude[bot] argued data-fidelity (keep the 02:30, "RawEvent is
immutable source data"); CodeRabbit argued correctness (fix it). Went with **fix**, and CodeRabbit endorsed
it. The deciding distinction: a one-shot frozen backfill is **curated seed data being authored**, not a
post-creation `RawEvent` mutation — the "immutable scraped data" rule doesn't apply to deciding what to seed.

> **Process note (→ research prompt):** "preserve source quirks" means **structural/identity facts** (a real
> run-number reuse across two distinct events, gaps, a verbatim title typo) — NOT value errors that (a)
> corrupt a sibling event on load via the merge's same-`(kennel,date,startTime)` fold, or (b) render an
> impossible value (a 2:30 AM trail). When a handoff lists "quirks to preserve," dry-run the backfill through
> the merge and check for same-date/same-startTime collisions and 12h-off / AM-PM time anomalies; fix those,
> preserve the rest. Distinguish a genuine same-day double-header (two real runs, different venues/themes)
> from a duplicate (same venue, colliding date) before preserving.

### C. 🔴 DNS-verify the **website** field — not just the data source

I live-verified the HC **source** rigorously (adapter fetch, GUID, cadence) but trusted the handoff's
`website: "https://bandung-hash.com/"` — which is **NXDOMAIN** (so are `bandunghash.com`, `bhhh2.com`,
`bandunghhh.com`, `bandung-hash.org`). A dead website renders a broken link on the kennel card. **claude[bot]
caught it** ("was this URL spot-checked?"). Removed the field — no HC kennel uses `hashruns.org/<slug>` as a
stand-in `website` (they use their own real site or none), and the live FB page (`facebookUrl`, verified 200)
is the external presence. This is the [verify-handoff-source-exists] failure mode applied to a *metadata* URL.

> **Process note (→ research prompt + Step "live-verify"):** the live-verification step must DNS/HTTP-check
> **every URL the handoff seeds** — `website`, `facebookUrl`, socials — not only the scrape source. A handoff
> can name a dead/parked domain (the source was thoroughly verified; the website was assumed). Drop a dead
> `website` rather than ship a broken card link; do not substitute the platform front-end (`hashruns.org`) —
> that's off-convention for `website`.

### D. 🟡 The `global-runs?isFuture=0` backfill endpoint — actual mechanics vs the handoff sketch

The handoff said "page 6-month windows filtered to the GUID." Reality, confirmed at build:
- `hashruns.org/api/global-runs?isFuture=0` **requires `minEventDate`+`maxEventDate`** (HTTP 400 "minEventDate
  and maxEventDate are required for past runs" without them).
- **`publicKennelId` is IGNORED** by the global endpoint — it returns ALL kennels' past runs in the window;
  filter **client-side** by `PublicKennelId`.
- Rows are **PascalCase** with `LocationOneLineDesc` + `LocationStreet`/`City`/`PostCode`/`Region`/`Country`
  (join with `", "` to byte-match the adapter's `composeHcLocation` output).
- **55 unique runs**, back to **#2253 2025-06-13** — BHHH2's **HC-join date**, not its 1984 founding. The deep
  pre-HC archive (#1–#2252) lives only on the (dead) kennel hub / FB. Confirms the LH3/PIH3 HC-coverage caveat.

> **Process note (→ platform notes):** the HC archive backfill source is `global-runs?isFuture=0` with REQUIRED
> `minEventDate`/`maxEventDate` date-window params and a **client-side** `PublicKennelId` filter (the kennel
> param is ignored). Expect coverage from the kennel's HC-join date forward, not its lifetime.

---

## Implementation / process learnings (loop context)

1. **🟢 Post-merge ran from the MAIN repo — it was clean (no doc-WIP conflict this time).** Unlike Shanghai
   (where main carried uncommitted doc WIP on a stale base), `git status` on main was clean, so a plain
   `pull --ff-only` to the merge commit was safe. `npx prisma generate` once (the client wasn't generated in
   main), then `db seed`, the backfill apply, and the scrape all ran against the prod `.env` there.
2. **🟢 Triggered the scrape via a one-shot `scrapeSource(id,{force:true})`, not the cron endpoint.** Worked
   headlessly; the `after()` / `revalidateTag` warnings ("called outside a request scope") are **expected** —
   those Next.js APIs only run inside an HTTP request, not a CLI script — and non-fatal (`success:true`,
   `errors:[]`). The kennel page rendered fresh anyway (it was never previously cached).
3. **🟢 `BACKFILL_ALLOW_SELF_SIGNED_CERT=1` set preemptively** for the Railway TLS path; harmless (db seed
   connected fine without it via `@/lib/db`). Node 25 (no `fnm`; 25 satisfies Prisma 7's "20+").
4. **🟢 Live-verify proved END-TO-END before CI** — `adapter.fetch` (1 upcoming, kennelTag, 14:30) → tsc +
   lint + **9602 tests** → prod `psql` after seed/backfill/scrape (56 events, fixed #2291/#2292 distinct, no
   02:30, no dup dates).
5. **🟢 Worktree vitest exclude workaround.** Running tests from inside `.claude/worktrees/**` zeroes them out
   (the config's exclude matches every path); used a temp `vitest.local.config.ts` minus that exclude, deleted
   before commit. (`prisma generate` first.)
6. **🔴 Prod domain is `hashtracks.xyz`, NOT `hashtracks.com`.** `hashtracks.com` is a parked "for sale"
   HugeDomains page (returns 200 with no app content) — a spot-check there is a false negative. `www.hashtracks.xyz`
   is canonical; `NEXT_PUBLIC_APP_URL` in `.env` is the dev `localhost:3000`.
7. **🟢 All gates green, focused churn.** CI (tsc/lint/9602 tests), SonarCloud Quality Gate (0 new issues),
   Codacy 0. Five commits; the three review fixes were each one-liners-to-small with a tracing reply +
   thread-resolve.

---

## TL;DR for the research prompt + platform notes

1. **Config-only HC onboard is near-mechanical** — mirror the nearest sibling (Taiwan/Shanghai): GUID
   `publicKennelId` + `defaultTitle` + `staleTitleAliases`, `trustLevel:8`, `scrapeDays:365`, single
   `kennelCodes`; zero new adapter code; the Lisbon coord/sentinel work handles the city-default pin.
2. **🔴 NEW — HC source + backfill ⇒ `upcomingOnly:true` is REQUIRED (not omitted).** The "omit per HC
   convention" line only holds for live-only HC kennels. A future-only adapter + a past backfill on the same
   source ⇒ reconcile false-CANCELs the archive (timeMin guard) unless `upcomingOnly:true`. Matches Asunción /
   nth3-tw. (Platform-notes HC section corrected.)
3. **🔴 NEW — curated backfill: fix value errors that corrupt on load; preserve only true structural quirks.**
   Same-`(kennel,date,startTime)` duplicates fold into one canonical (mislabeling a sibling) → drop the
   duplicate; 12h-off / AM-PM time typos render impossible cards → normalize. Dry-run the backfill through the
   merge and scan for date/time collisions before trusting a "preserve quirks" instruction.
4. **🔴 NEW — DNS/HTTP-verify the `website` + every seeded URL, not just the source.** A handoff can name a
   dead/parked domain; drop a dead `website` (don't substitute the platform front-end).
5. **`global-runs?isFuture=0` is the HC backfill source** — REQUIRED `minEventDate`/`maxEventDate`, kennel
   param IGNORED (client-side `PublicKennelId` filter), PascalCase rows, coverage from the HC-join date.
6. **Keep:** the recently-active framing, the verbatim-oracle + "reconfirm from local env" flag, the
   bare-shortcode alias-collision discipline, the magic-byte logo extension, the METRO-under-existing-COUNTRY
   4-edit scope, and the worktree-path discipline.
