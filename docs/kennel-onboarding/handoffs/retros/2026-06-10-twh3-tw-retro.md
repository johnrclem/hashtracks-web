# Cowork Handoff Retro — Taiwan H3 (🇹🇼 HashTracks' first Taiwan kennel, est. 1975) — 2026-06-10

Feedback from the Claude Code implementation session for the `2026-06-10-twh3-tw.md` handoff — a
**pure config-only `HARRIER_CENTRAL`** onboard (zero new adapter code, mirrors Lisbon/Porto/Hamburg H7)
+ new **Taiwan COUNTRY + Taipei METRO** region (all 5 `region.ts` edits, **sky** palette) + a
self-hosted logo. No backfill. The handoff was high-fidelity and held almost entirely — the one real
divergence was a **CJK gap in `COUNTRY_INFERENCE_RULES`** the handoff explicitly called "optional" but
that CodeRabbit (correctly) flagged as a silent-mis-inference bug.

> Context: this was the day's *second* target. The original primary — **Lima H3** (🇵🇪, Blogspot) — was
> **aborted at build**: the handoff's blocking live-verify gate found the blog reachable via the keyed
> Blogger API but **dormant** (newest run 2023-09-07, ~6 runs total). Per the handoff's own "STOP if
> dormant" rule we didn't ship it; the user pivoted to Taiwan. (See run-log; the gate worked as designed.)

**PRs produced:**
- Onboarding (kennel/alias/source + Taiwan COUNTRY/Taipei METRO + self-hosted logo): [PR #2107](https://github.com/johnrclem/hashtracks-web/pull/2107) (merged). Three commits — the seed/region base, a CJK-inference fix (CodeRabbit), and an S6035 char-class fix (SonarCloud).
- Docs (this retro + run-log/queue → SHIPPED + Taiwan platform-notes addenda): this PR.

**Outcome:** Live at https://www.hashtracks.xyz/kennels/taiwan-h3 (HTTP 200) — **3 upcoming canonical
Events** (#2662 2026-06-14, #2663 06-21, #2664 06-28, all weekly Sun 14:30, `CONFIRMED`). Post-merge ran
from the **worktree** on prod `.env` (main repo carried the user's uncommitted doc WIP): `prisma generate`
→ `db seed` (additive — **Created 1 / Updated 387**) → `scrapeSource(force:true)` → **eventsFound 3 /
created 3 / 0 unmatched / 0 blocked / 0 errors**. Prod query confirmed kennel `twh3-tw`, source +
`SourceKennel` link, both regions, 3 events (#2662 kept its real New-Taipei coords; #2663/#2664 default
pin dropped → Taipei centroid).

---

## The loop is working — previous retro fixes LANDED

1. **New-country 5-edit `region.ts` checklist (ONH3 / Budapest / Paris / Mexico retros).** The handoff
   carried all five edits explicitly (REGION_SEED_DATA COUNTRY+METRO, `STATE_GROUP_MAP`,
   `COUNTRY_GROUP_MAP` country-only key, `COUNTRY_CODE_TO_NAME`, `COUNTRY_INFERENCE_RULES`) mirroring the
   Japan/Tokyo precedent, and called out the `inferCountry → "USA"` failure mode. All five landed.
2. **kennelCode collision discipline (Lisbon / Budapest retros).** The handoff led with the `twh3`=Tidewater
   collision and prescribed the `twh3-tw` suffix + bare-`TwH3` alias omission. Landed exactly.
3. **`<ext>` logo placeholder, confirm via magic bytes (ah3-nz / Budapest retros).** Handoff used a literal
   `<ext>`; asset was a genuine PNG (`\x89PNG`, 200×200 RGBA) → referenced `/kennel-logos/twh3-tw.png`.
4. **Split adapter-verify from post-merge seed (ZH3 / Budapest retros).** Structured exactly so —
   `adapter.fetch()` (no DB write) pre-PR confirmed the 3 events; `db seed` + `scrapeSource` as a separate
   post-merge runbook. Landed.
5. **Config-only HC pattern (Lisbon / Porto / Hamburg).** Mirrored verbatim — `publicKennelId` GUID +
   `defaultTitle` + `staleTitleAliases`, `upcomingOnly` omitted. Zero new code, as predicted.

---

## What the handoff got RIGHT (keep doing)

1. **Captured the stable `publicKennelId` GUID, not just the city/short-name filters.** All three filters
   returned the identical 3-event set; the handoff seeded the GUID (most stable). Live-verify reproduced
   exactly 3 events from local env — the Azure-host sandbox block (verified via browser page-context) did
   not hide anything.
2. **Predicted the coord behavior precisely.** #2662 real New-Taipei venue+coords kept; #2663/#2664
   "No location provided" → `hcGeocodeFailed` drops the default pin → Taipei centroid. Confirmed in prod.
3. **kennelCode collision flagged up front with the exact mechanism** (kennelCode-exact-match precedes
   alias-match → bare `TwH3` would route to Tidewater). No surprise at build.
4. **Sky palette chosen to avoid East-Asian neighbors** (Japan/Singapore/HK red, Thailand orange, Malaysia
   green). No clash.
5. **`foundedYear` 1975 with the 1976-on-logo discrepancy pre-resolved** from the kennel's own correction.
   `hashCash` flagged lower-confidence (gender-tiered, per-run variable). Both held.

---

## Handoff GAPS → research-prompt / process improvements (the actionable part)

### A. 🔴 CJK `COUNTRY_INFERENCE_RULES` coverage was marked "optional" — it was a real silent-mis-inference bug

The handoff's region edit #5 added the ASCII rule `[/\b(taiwan|taipei|…)\b/, "Taiwan"]` and noted CJK
coverage as **"Optional … not required"**, reasoning that the English `eventCityAndCountry` ("Taipei,
Taiwan") matches and #2662 carries explicit coords. But TwH3's #2662 also carries a **Chinese-only**
location field (`新北市, 台灣`), and `\b` is ASCII-only — so that input defaulted to **"USA"**. CodeRabbit
flagged it; I fixed it in-PR by appending a CJK branch to the same rule:
`[/\b(taiwan|taipei|new taipei|formosa|kaohsiung|taichung|tainan)\b|[台臺][灣北中南]|新北|高雄/, "Taiwan"]`
(`[台臺]` unifies the common/formal Tai- forms; `inferCountry` lowercases first but that's a no-op on CJK).
Verified: `inferCountry("新北市, 台灣") → "Taiwan"` (was "USA"), no regression.

This aligns with the project's fail-loud-over-silent-corruption philosophy: defaulting Taiwan text to "USA"
is exactly the silent mis-route the rule exists to prevent.

> **Prompt change (suggested):** for a **CJK-locale country** (Taiwan, Japan, HK, China, Korea, Thai
> script, etc.), the `COUNTRY_INFERENCE_RULES` entry must include a **CJK branch** (literal native tokens,
> no `\b`) — it is **required, not optional**. `\b` matches only ASCII word boundaries, so any Chinese/CJK
> location field silently falls through to "USA". (→ platform note added.)

### B. 🟡 Single-character CJK alternation tripped SonarCloud S6035

The first cut of the CJK branch used `[台臺](灣|北|中|南)`; SonarCloud flagged **S6035** ("Replace this
alternation with a character class") on the `(灣|北|中|南)` group → `[灣北中南]`. Quality gate had still
*passed* (it's a MINOR maintainability smell), but it surfaced as "1 New issue" and I tightened it to 0.

> **Prompt note:** when hand-writing a regex branch, use a **character class** `[abc]` for any all-single-
> character alternation, never `(a|b|c)` — Sonar S6035. (Same rule that prefers `[-:]` over `(?:-|:)`.)

### C. 🟡 Handoff `region.ts` line numbers had drifted ~200 lines; and a scout agent's claims needed verifying

The handoff cited `STATE_GROUP_MAP` ~`:3445` / `COUNTRY_GROUP_MAP` ~`:3770`; actual were `:3617` / `:3869`
(the file grows daily as kennels onboard). Re-located each edit by **anchor string** (`"Tokyo": "Japan"`,
`"Singapore": "Singapore"`, `TH: "Thailand"`), not the cited line. Separately, an exploration agent made two
**false claims** — that `COUNTRY_INFERENCE_RULES` returns ISO codes (it returns the country *name*; its own
pasted "Thailand" example disproved it) and that `region.test.ts:63` would break (it's self-referential,
`options.length` vs `REGION_SEED_DATA.length` — both grow together). Both were checked against source before
trusting; neither held.

> **Prompt note:** treat handoff line numbers as hints — locate edits by a stable anchor string. Verify any
> scout/sub-agent assertion against the actual source before acting (the handoff itself was correct here;
> the agent's gloss was not).

---

## Implementation / process learnings (loop context)

1. **🟢 Post-merge ran from the worktree, NOT the main repo (PIH3 / Budapest precedent).** The main repo
   carried the user's uncommitted doc WIP (run-log/target-queue/source-platform-notes incl. Taiwan+Lima
   HANDED-OFF entries) — a `git pull` would not clobber it (no file overlap), but seed/scrape ran from the
   worktree (tree == `origin/main` after merge) with the main repo's prod `.env`. `npx prisma generate` once
   per fresh checkout (gitignored `@/generated/prisma`). Node 25 (no `fnm`; satisfies Prisma 7's "20+").
2. **🟢 CLI-context scrape `after()` / `revalidateTag … no request scope` is expected and harmless.** Those
   APIs no-op outside a Next.js request; the DB writes persisted and the brand-new kennel page rendered 200.
   Same as the PIH3 / Budapest notes.
3. **🟢 Live-verify proved END-TO-END before CI.** `adapter.fetch(source, {days:365})` returned the 3 events
   (correct dates UTC-noon, `14:30`, `kennelTags=["twh3-tw"]`, 0 errors) before tsc/lint/test (8862 green).
   A prod query after seed+scrape then confirmed kennel + source + `SourceKennel` + both regions + 3 events.
4. **🟢 Review gates: one false positive, one real catch, all handled with no churn.** Gemini flagged the
   inference rule but invented a `{country, matches}` shape that doesn't exist (the codebase uses
   `[RegExp, string]` tuples) — declined with that rationale + the verified `inferCountry` output, thread
   resolved. CodeRabbit's CJK catch (Gap A) → fixed. Codex "no major issues". SonarCloud 1→0 after the S6035
   fix; Codacy 0. Each inline thread got a one-line reply + resolve.

---

## TL;DR for the research prompt + platform notes

1. **CJK-locale countries need a CJK branch in `COUNTRY_INFERENCE_RULES` — required, not optional.** `\b` is
   ASCII-only; a Chinese/CJK-only location field defaults to "USA" without it. Append literal native tokens
   (`[台臺][灣北中南]|新北|高雄`); use a **character class** for single-char alternations (Sonar S6035).
   (Prompt + platform note + memory updated.)
2. **kennelCode-collision (not just alias-collision): suffix the kennelCode AND drop the bare shortcode
   alias.** A new HC kennel's `kennelUniqueShortName` can equal an existing **kennelCode** (Taiwan "TwH3" →
   `twh3` = Tidewater); kennelCode-exact-match precedes alias-match, so a bare alias silently mis-routes.
3. **Locate `region.ts` edits by anchor string, not the handoff's line number** (the file drifts daily); and
   verify sub-agent claims against source before acting.
4. **Keep:** the config-only HC pattern (GUID filter + `defaultTitle`/`staleTitleAliases`, `upcomingOnly`
   omitted), the new-country 5-edit checklist, kennelCode collision discipline, `<ext>` logo + magic-byte
   verify, the split adapter-verify / post-merge-seed runbook, and the **recency gate** (Lima proved its
   worth — a reachable-but-dormant source must be aborted, not shipped).
