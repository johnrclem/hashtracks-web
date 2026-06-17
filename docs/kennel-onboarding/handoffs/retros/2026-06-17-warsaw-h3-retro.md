# Cowork Handoff Retro — Warsaw H3 (Warsaw, Poland, est. 1983) — 2026-06-17

Feedback from the Claude Code implementation session for the `2026-06-17-warsaw-h3.md` handoff —
HashTracks' **first 🇵🇱 Poland kennel**: a small static **Mobirise SSR** scraper (`warsawh3.com/`) that
parses a single-page "next run" detail block + an "Upcoming runs" list, plus a brand-new country. Goal:
fold the genuine learnings back into the **research prompt** + **platform notes**. Notably, the four
review bots (Codex adversarial, Gemini, CodeRabbit, SonarCloud) each caught a distinct real issue here,
and one — the hare tri-state — is a **recurring handoff-wording bug worth fixing at the source.**

**PR produced:**
- Onboarding (kennel + alias + source + NEW `WarsawH3Adapter` + Poland/Warsaw region + self-hosted logo +
  11 tests): [PR #2234](https://github.com/johnrclem/hashtracks-web/pull/2234) (merged).

**Outcome:** Live at https://www.hashtracks.xyz/kennels/warsaw-h3 — **4 canonical events** #1643–#1646
(2026-06-20 → 2026-08-01), #1643 "Warsaw H3 Trail #1643" (2026-06-20 14:00, hare Stiff Pointer, venue
"the Presidential Hotel opposite the central railway station") CONFIRMED, placeholders (`???`,
`It Could Be You!`) stored as cleared. One code PR (no backfill — no on-site archive). Post-merge from the
worktree on prod `.env`: `db seed` (Created 1 / Updated 415) → `scrapeSource()` (created 4 / 0 errors) →
spot-checked.

---

## The loop is working — previous retro fixes LANDED

1. **Single-page SSR = `fetchHTMLPage`, no `browserRender`** (Manila/Seoul learning) — held; a plain static
   fetch returned the full feed (the whole thing is one SSR'd `<p>`).
2. **`config.upcomingOnly: true` + mandatory fail-loud `rows.length === 0` guard** — both pre-stated and
   implemented; the guard pushes `errors: ["Warsaw H3: no run rows parsed — Mobirise markup may have
   changed"]` so reconcile is suppressed instead of a silent `events: []` on a brand-new 0-baseline source.
3. **5-edit `region.ts` for a brand-new country** (Poland COUNTRY + Warsaw METRO, mirror Hungary/Budapest,
   2-level so **no `seed.ts` stateMetroLinks**) — complete and correct (but see Gap C — the inference rule
   needed narrowing).
4. **`manila-h3.ts` + `bangkok-monday-hash.ts` as reference adapters** — exactly right (single SSR block +
   fail-loud from Manila; next-run-block ⊕ list merge-by-run-number from Bangkok). Named in the handoff,
   carried over directly.
5. **Self-host the logo** (`…-n.jpg-96x96.jpg` → `public/kennel-logos/warsaw-h3.jpg`, magic-byte-confirmed
   JPEG) — done. The un-suffixed original 404'd, so the 96px is the only asset (handoff anticipated this).
6. **`title` undefined → merge synthesizes "Warsaw H3 Trail #N"** — correct; `friendlyKennelName("Warsaw
   H3", …)` short-circuits on the >4-char shortName (verified live: titles are "Warsaw H3 Trail #1643"…).
7. **`scheduleTime` = 12-hour "2:00 PM"** (the sh3-kr-retro Gap B fix) — the handoff got it right this time;
   `scheduleRules.startTime` stays 24-hour "14:00". No correction needed. **The previous retro's fix held.**
8. **Capture-the-real-DOM mandate** — confirmed the structure before parsing (see Gap F): the feed is a
   single `<p class="mbr-text mbr-fonts-style display-7">` with `<br>` separators + a *decoy* `display-7`
   blurb above it → the parser anchors on the `WH3 Run #` marker, not "first paragraph".

---

## What the handoff got RIGHT (keep doing)

1. **The `▶ FOR CLAUDE CODE` directive** — branch name, ordered steps, live-verify mandate, post-merge
   runbook — drove the session end-to-end.
2. **Verbatim sample + field-fill table** — runs #1643–#1646, `14h00` time, venue/hare mapping, biweekly-Sat
   14-day cadence all mapped as predicted. The `14h00` (`h` separator) → `"14:00"` normalization was flagged.
3. **🟢 Dates carry the year → NO inference** — `Sat 20 June 2026` / `July 4, 2026` parsed straight to UTC
   noon; correct (unlike Bangkok Monday / Taipei).
4. **Coord sanity = no default-pin trap** — handoff said "no per-run coords, fall back to centroid." Live:
   the vague venue text geocoded **8021 km off**, the merge **skipped** the bad coord (geo-validation guard)
   → Warsaw centroid fallback. No fabricated pin. Exactly as predicted.
5. **kennelCode `warsaw-h3` + bare "WH3" alias OMITTED** (White House DC / Wolf Pack collision) — correct;
   grepped prod, no collision.
6. **No backfill** — correctly assessed (Events/News/Pix pages carry no run history).

---

## Handoff GAPS → research-prompt / platform-note improvements (the actionable part)

### A. 🔴 Hare placeholders must be `null` (explicit clear), NOT `undefined` — recurring handoff-wording bug

The handoff (and `source-platform-notes.md`'s Mobirise note) said *"strip hare placeholders → `undefined`."*
That's **wrong** and the **Codex adversarial review** caught it: the merge pipeline treats `hares: undefined`
as *preserve-existing* and `hares: null` as *explicit clear* (merge.ts:106-111 / :1664, issue #2032). So a
run whose named hare is later replaced by a placeholder (`Hare: ???`) would have **kept the stale hare** on
the canonical event. The fix is the established tri-state (`nswhhh.ts` / `bruh3.ts` / `victoria-h3.ts`):
recognized placeholder → `null`; genuinely-absent hare field → `undefined`; real name → the string.

> **🔴 Prompt + platform-note change:** the placeholder-hygiene instruction must say **"recognized
> placeholder → `null` (explicit clear); only a *missing* hare field → `undefined`."** Never "strip to
> `undefined`." This is the SAME tri-state as the `trailLength`/`difficulty` atomic-bundle rule already in
> `adapter-patterns.md`; it applies to `hares`/`location`/`cost`/`description` too. Mirror the reference
> adapters' `placeholder ? null : value || undefined`.

### B. 🟡 Same-run merge must be field-by-field tri-state — winner-take-all drops fields, and `??` breaks the null clear

The first `upsertEvent` replaced the whole row when the incoming one had a location — **Gemini + CodeRabbit**
flagged that this drops other fields (e.g. a non-placeholder hare). The naive fix CodeRabbit suggested
(`event.hares ?? existing.hares`) is **also wrong**: `??` coalesces on `null`, silently reverting the Gap-A
hare-clear back to the stale hare. The correct shape is a **defined-fields merge**:
`{ ...existing, ...Object.fromEntries(Object.entries(event).filter(([,v]) => v !== undefined)) }` — a defined
value wins (including an explicit `null`), `undefined` keeps existing. (Bonus: it also sidesteps Sonar S6606
"prefer `??`" / S7735, which fire on the equivalent ternary but don't know `??` is semantically wrong here.)

> **Prompt change:** when an adapter merges two shapes for the same run (next-run detail ⊕ list row), specify
> a **tri-state field-merge** (defined-incl-null wins; `undefined` preserves), and explicitly **warn against
> `??`** for any field that can be `null` (hares). CodeRabbit even logged this as a repo learning.

### C. 🔴 New-country inference rule must EXCLUDE bare city tokens that are also common US/other place names

The handoff's `COUNTRY_INFERENCE_RULES` rule was `/\b(poland|warsaw|warszawa|polska)\b/`. The bare **`warsaw`**
token is a problem — `inferCountry()` is first-match with a **USA default fallthrough** and is called on
free-form admin research input (`admin/research/actions.ts`), so "Warsaw, IN" / "Warsaw, NY" would classify
as Poland. **Codex (P3)** caught it. Fix: drop the bare ambiguous token — `/\b(poland|warszawa|polska)\b/`
still matches "Warsaw, Poland" via the `poland` token, and `warszawa`/`polska` are unambiguous; "Warsaw, IN"
correctly falls through to USA. (This is the same shape as the **Victoria, BC vs Victoria, Australia** guard
already in the file — added a parallel disambiguation test.)

> **🔴 Prompt change:** for a new-country inference rule, **list only unambiguous tokens** — the country name,
> native spellings (`warszawa`/`polska`), and city names that are NOT common US/other place names. A bare
> city token that doubles as a US place name (Warsaw, Berlin, Paris, Moscow, Cambridge, …) must be **omitted**
> (the country-name token still catches "City, Country" input). The seed kennel carries an explicit
> `country`, so it's unaffected — this only protects the free-form research path.

### D. 🟡 New date/text regexes trip S5852 — author them backtracking-safe, don't lean on "mark SAFE"

Two S5852 (ReDoS) hotspots failed the SonarCloud gate: an **unbounded leading `[A-Za-z]+` on an unanchored**
date regex (`/([A-Za-z]+)\s+\d{1,2},\s+\d{4}/` — O(n²) start-position backtracking) and a **`\s*` adjacent to
`.+`** (`/^Hare:\s*(.+)$/`). Both were rewritten clean rather than marked SAFE: bound the month to
`[A-Za-z]{3,9}` + single `\s` separators; drop the `\s*` (the value is trimmed downstream). Gate passed with
0 hotspots, no manual API marking needed.

> **Platform-note change (extends the Boise/Seoul regex guidance):** a leading **unbounded `+`/`*` on an
> unanchored regex** is itself an S5852 trigger — **bound it** (`{3,9}` for month names) or anchor it. And
> never put `\s*`/`\s+` **adjacent to `.+`/`.*`** — drop it and trim in code. Prefer rewriting to marking
> SAFE when the rewrite is this cheap.

### E. 🟢 Biweekly / INTERVAL>1 `scheduleRules` need an `anchorDate` — added proactively

The handoff's `scheduleRules` was `FREQ=WEEKLY;INTERVAL=2;BYDAY=SA` with **no `anchorDate`**. `INTERVAL=2` is
phase-ambiguous (which Saturday?) — the projection engine can't know which fortnight without an anchor (the
`KennelScheduleRuleSeed` interface documents `anchorDate` "for INTERVAL>1 stability"; SLOH3's biweekly rule
sets it). Added `anchorDate: "2026-06-20"` (run #1643, a confirmed real date).

> **Prompt change:** the "Ready-to-paste seed" checklist should require an **`anchorDate` on any
> `scheduleRules` rule with `INTERVAL` > 1** (anchored to a known real run date), not just `BYDAY`.

### F. 🟢 The sandbox `curl` block was sandbox-local — `curl`/`fetchHTMLPage` worked from the Claude Code env

The handoff flagged that the research sandbox couldn't `curl warsawh3.com` (exit 56, allowlist-blocked) and
mandated re-capturing the DOM at build. From the Claude Code environment `curl` returned HTTP 200 / 10.6 KB
immediately. The captured DOM confirmed the handoff's structural guess exactly (single `<p>` + `<br>`s, plus
a decoy blurb paragraph), so the fixture is byte-accurate.

> **Process note (already in the playbook, reaffirmed):** the research sandbox's `web_fetch`-only / `curl`-
> blocked constraint is **not** the build environment's — always `fetchHTMLPage`/`curl` the live page at build
> to capture the verbatim DOM for the fixture. The "UNVERIFIED — confirm at build" caveat in a platform note
> means *capture it*, and it usually confirms (not contradicts) the research guess.

---

## Implementation / process learnings (loop context)

1. **Four review bots, four distinct real catches** — Codex adversarial (Gap A hare tri-state, Gap C
   inference collision), Gemini + CodeRabbit (Gap B winner-take-all merge), SonarCloud (Gap D ReDoS). The
   pre-PR `/simplify` + `/code-review` and the post-PR bot rounds each earned their keep; none was noise.
2. **`/simplify` earned a real reuse cut** — replaced a bespoke placeholder Set with the shared
   `stripPlaceholder` from `utils.ts`, keeping only the kennel-specific "It Could Be You!" guard (correct
   altitude — a universal placeholder belongs in shared infra, a local in-joke doesn't).
3. **One robustness fix from `/code-review`** — bounded the next-run block at the first list row (not just the
   "Upcoming runs" heading) so a heading-text drift can't bleed list rows into #1643's hare field.
4. **Post-merge ran from the worktree on the prod `.env`** — `db seed` additive (Created 1 / Updated 415),
   `scrapeSource(force)` **created 4 / 0 errors**. The CLI-context `revalidateTag`/IndexNow "outside request
   scope" warnings are harmless (DB writes commit; the new kennel page renders fresh).
5. **Production domain `www.hashtracks.xyz`** (`.com` 302-redirects to `.xyz`); `/kennels/warsaw-h3` → 200,
   rendering the profile + run #1643.

---

## TL;DR for the research prompt + platform notes

1. **🔴 Hare/optional-field placeholders → `null` (explicit clear), NOT `undefined`** — `undefined` preserves
   a stale value through the merge (#2032). Use `placeholder ? null : value || undefined` (the
   nswhhh/bruh3/victoria-h3 pattern). Never say "strip to undefined."
2. **🔴 New-country inference rule = unambiguous tokens only** — country name + native spellings; OMIT a bare
   city token that's also a US/other place name (Warsaw/Berlin/Paris/Moscow…). Protects the free-form
   research path (`inferCountry` defaults to USA).
3. **Same-run merge = tri-state field-merge** (defined-incl-`null` wins, `undefined` preserves); **never `??`**
   on a nullable field.
4. **New regexes:** bound leading `+`/`*` on unanchored patterns (`{3,9}` for months), no `\s*` adjacent to
   `.+` — rewrite clean, don't lean on "mark SAFE."
5. **`scheduleRules` with `INTERVAL` > 1 needs an `anchorDate`** (a known real run date).
6. **`Kennel.scheduleTime` = 12-hour "2:00 PM"; `scheduleRules.startTime`/`RawEventData.startTime` = 24-hour
   "14:00"** — the sh3-kr fix held; keep it in the seed checklist.
7. **Keep:** the `▶ FOR CLAUDE CODE` directive, single-block fail-loud + `upcomingOnly`, the 5-edit
   new-country `region.ts` pattern (2-level → no `stateMetroLinks`), `manila`/`bangkok-monday` references,
   coord-sanity (no default-pin), `title`-undefined synthesis, self-host-logo (magic bytes), and
   capture-the-real-DOM at build.
