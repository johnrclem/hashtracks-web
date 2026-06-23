# Cowork Handoff Retro — Colombo Harriettes (Colombo, Sri Lanka) — 2026-06-22

Feedback from the Claude Code implementation session for the `2026-06-22-colombo-harriettes.md` handoff —
the **Colombo Hash House Harriettes** (mixed-gender, est. 20 June 1984), HashTracks' **first Sri Lanka
kennel**. A small static **custom Next.js single "Next run" block** scraper opening a brand-new country.
Goal: fold the genuine learnings back into the **research prompt** + **platform notes**.

The headline this run: the handoff was again unusually complete and every research-time call held live —
SSR confirmed (no browserRender), the **placeholder-vs-filled three-way discriminator**, `upcomingOnly` +
fail-loud, `title`-undefined synthesis, the Maps-**embed** `!2d`/`!3d` in-adapter coord parse, the rose
palette (verified clear of every Asian neighbour), and the recently-active onboard (0 upcoming at research,
placeholder state). But this onboard had the **richest review/fix cycle of any so far**, and the reason is
the central characteristic of the kennel: **the FILLED-state DOM was never observable** (the live site sat
in its placeholder state from research through merge), so the run-detail parser + test fixtures are
**constructed** from the one documented #2223 sample. Three review bots (Gemini, Codex, CodeRabbit) then
stress-tested that constructed surface and surfaced **four real robustness gaps** the local tests couldn't —
and one fix added mid-review (a segment-split regex for Codex) **itself tripped a SonarCloud ReDoS rule** on
the next push. The other notable bite was a **worktree-path slip**: the implementation edits initially
landed in the **main** checkout (the Bash cwd reset masks it), and had to be relocated to the worktree
branch while preserving another session's uncommitted docs WIP.

**PR produced:**
- Onboarding (kennel + alias + source + NEW `ColomboHarriettesAdapter` + Sri Lanka COUNTRY + Colombo METRO
  + self-hosted PNG logo + a one-row #2223 backfill + 12 tests), with **three follow-up review-fix commits**
  (PR review → SonarCloud → CodeRabbit): [PR #2278](https://github.com/johnrclem/hashtracks-web/pull/2278)
  (merged, true merge commit — all 4 commits on `main`).

**Outcome:** Live at https://www.hashtracks.xyz/kennels/colombo-harriettes — **1 canonical CONFIRMED event**
(the opted-in backfill), **run #2223, Sat 2026-06-20**, title synthesized **"Colombo Harriettes Trail
#2223"**, `startTime` 17:00, venue "KK's Crib", street "No.5, 1st Cross Street, Kandawala Road, Ratmalana",
trust 6. **Sri Lanka COUNTRY (rose `-200`, pin `#e11d48`) + Colombo METRO (rose `-100`, `#f43f5e`)** — first
Sri Lankan country, all 5 `region.ts` edits. Post-merge from **synced `main`** on prod `.env`: `db seed`
(created the kennel + source + 3 aliases + roster group + both regions) → ran the **#2223 backfill**
(`created=1`) → `POST /api/cron/scrape/<id>` with the `CRON_SECRET` (**eventsFound 0, errors [], cancelled
0** — the clean placeholder scrape, #2223 untouched) → psql-verified every record + spot-checked the live
page (renders the run at "5:00 PM GMT+5:30", confirming the `Asia/Colombo` tz).

---

## The loop held — handoff + prior-retro patterns that LANDED

1. **The placeholder-vs-filled three-way discriminator was exactly right.** Live-verify returned
   `events: 0, errors: []` against `hashcolombo.com` at build AND on the post-merge prod scrape — the clean
   between-postings state, never a parse error. The guard distinguishes (a) placeholder → 0/clean,
   (b) a parseable run → 1 event, (c) a run block that won't parse / an unrecognized block → `errors[]`.
2. **SSR resolved at research held.** Plain `fetchHTMLPage` (static Cheerio) — the "Next run" `<p>` and its
   sibling content `<p>` share an immediate parent `<div>`, so `$(heading).parent()` bounds the block with
   no boundary guessing. The modern Next.js frame did NOT mean client-rendered (verify-per-site held).
3. **`config.upcomingOnly: true` protected the past #2223.** The post-merge scrape (0 live events) ran
   reconcile clamped to the future → `cancelled: 0`; the backfilled past run survived, exactly as designed
   (Manila/Warsaw/Saigon/Hanoi pattern).
4. **`title` undefined → merge synthesized "Colombo Harriettes Trail #2223"** — verified in prod;
   `friendlyKennelName("Colombo Harriettes", …)` short-circuited on the >4-char shortName, as predicted.
   Venue ("KK's Crib") and run header never leaked into `title`.
5. **Maps-EMBED coord parse + LK bbox sanity.** The handoff's `!2d`=lng/`!3d`=lat in-adapter parse
   (`extractCoordsFromMapsUrl` does NOT match `/maps/embed?pb=…` — the Asunción lesson) + a Sri-Lanka
   bounding-box gate to reject a default/garbage pin.
6. **Rose palette — verified clear, NOT cyan.** Re-grepped `REGION_SEED_DATA`: rose is used only by the UK
   (country + London metros) and two far US metros — all "US/Europe owners", distinct from every Asian
   neighbour (Vietnam=cyan #2269, Nepal=violet, Cambodia=purple, etc.). The handoff's "swap if it collides
   with a *nearer* region" condition was not triggered; the handoff's own reasoning was correct.
7. **Alias collision discipline.** Bare `"Harriettes"` OMITTED (global `harriettes-nyc`); `"Colombo Hash"` /
   `"Colombo H3"` OMITTED (the men's sibling The Colombo H3); kept `CHHH` + the two full forms.
8. **Self-host the logo + magic-byte the extension** — declared the `/logomain.png` self-host as `.png`,
   confirmed `\x89PNG` (160×160 RGBA) before writing the path.
9. **Optional 1-row backfill (user opted in)** — the kennel page shows a real run immediately instead of
   being empty until the committee posts the next Saturday; `upcomingOnly` keeps reconcile off the past row.

---

## What the handoff got RIGHT (keep doing)

1. **The `▶ FOR CLAUDE CODE` directive** — branch → seed → adapter → live-verify → tsc/lint/test → PR →
   ordered post-merge runbook — drove the session and the post-merge (seed → backfill → scrape →
   spot-check) verbatim, including the "expect 0 events on the first scrape if still in placeholder state".
2. **The field-fill table + verbatim #2223 sample** — run # + venue (no theme) → `title` undefined, 17:00,
   "KK's Crib", the Ratmalana street, "hares not seen → undefined (don't synth)" — all matched the
   constructed parse.
3. **DNS pre-check + 448-slug sitemap dedup** — `hashcolombo.com` → Cloudflare; no
   `colombo`/`lanka`/`ceylon`/`srilanka` slug; the two `harriettes` slugs disambiguated (NYC + Bangkok).
4. **"Ceylon" excluded from inference** — kept only as a region alias (Ceylon, MN collides); `sri lanka` +
   `colombo` are both unambiguous.

---

## GAPS / corrections → research-prompt / platform-note improvements

### A. 🔴 Worktree-path slip — the implementation edits landed in the MAIN checkout, not the pre-created worktree

The session ran inside a pre-created git worktree, but every `Write`/`Edit` used a **main-repo absolute
path** (`/…/hashtracks-web/src/…`) while the Bash cwd silently resets to the worktree between calls — so the
branch lived in the worktree (clean) while all 9 files landed in `main`'s working tree. Caught it only when
a `vitest` run printed the **main** repo root. Recovery: copied the 9 files worktree-ward, `git checkout --`
reverted the tracked edits in `main` **surgically** (leaving another session's uncommitted docs WIP —
`run-log`, `target-queue`, `source-platform-notes`, a `tymh3` handoff — untouched), and `rm`'d the stray
untracked files from `main`. This is the recurring worktree hazard (Saigon retro #1, Phnom Penh retro #2 —
both bit; Hanoi #1 held). The reset masks it: paths look right, the cwd is wrong.

> **🔴 Prompt reinforcement:** when the session is handed a pre-created worktree, **derive the worktree
> absolute prefix once and use it for EVERY `Write`/`Edit`/`Read`/`rm`** — do not trust that a main-repo
> absolute path "is" the working copy. After the first edit, `git status` in the worktree to confirm the
> change shows there, not in `main`. (Standing memory `feedback_worktree_bash_cwd_resets_to_main`; third+
> confirming case.)

### B. 🔴 Unconfirmed FILLED-state DOM → build for MULTIPLE plausible render shapes; expect the review bots to stress-test the surface you couldn't see

Because the site stayed in its placeholder state, the run-detail parser + the "filled" test fixture were
**constructed** from the documented #2223 sample (one render shape: separate `<p>`s per field). The review
bots then probed render shapes the sandbox never saw, and **all four findings were real**:
- **Gemini (medium):** a street carrying a month name (`12 May Road`, `June Street`) could be mis-read as
  the run date → added a `STREET_HINT_RE` early-return to `isDateLine`.
- **Codex (P2):** if the committee renders the run as **one dash-joined line**
  (`Run #2223 — 2026-06-20 — KK's Crib — 17:00 — …`), the whole line became the `dateLine` and `parseVenue`
  skipped it → venue/street dropped. Fix: split each block line into per-field **segments** on
  dash/pipe/bullet separators (a bare hyphen excluded so ISO dates stay intact), so single-line and
  multi-`<p>` renders parse identically.
- **CodeRabbit (minor):** `TIME_12H_RE` accepted any two digits for minutes → `5:99 PM` would have emitted
  `17:99`. Constrained hours `1–12` / minutes `00–59` (reject rather than emit garbage).
- **CodeRabbit (major):** `extractEmbedCoords` scanned the whole document → an unrelated maps iframe
  elsewhere could mis-populate the event's coords. Scoped the lookup to the enclosing run `<section>`
  (a wrong pin is worse than no pin).

> **🟡 Prompt/platform-note add (done):** for an **unconfirmed-FILLED-DOM onboard** (single-block site caught
> in its placeholder/empty state at research), state explicitly in the handoff that the run-detail extraction
> is built against the documented sample and **must tolerate both a multi-element and a single-line
> dash-joined render** — and that the fail-loud guard is the safety net for the real markup. Expect the
> review pass (Gemini/Codex/CodeRabbit) to probe exactly that constructed surface; budget a fix round.

### C. 🔴 A fix added *mid-review* tripped SonarCloud — re-run Sonar after EVERY review-fix push, not just the first

The Codex fix (Gap B) introduced a segment-split regex `/\s*[—–|•·]\s*|\s+-\s+/`. Local `tsc`/`lint`/full
`vitest` and the GitHub `test`/CodeRabbit/Codacy checks were all green, but the next **SonarCloud** pass
failed it as **S8786 (MAJOR, ReDoS)** — `\s*…\s*` adjacent to an alternation backtracks super-linearly — plus
two **S7748 (minor)** zero-fraction literals (`10.0`/`82.0`) in the LK bbox. Fix: replaced the regex with two
**linear** passes (string `split(" - ")` then a char-class split, no quantifier-adjacent alternation) and
dropped the zero fractions. Same standing lesson as Hanoi retro D — but the new wrinkle is that the offending
regex was **added in response to a different reviewer**, so the Sonar pass that mattered was the one after the
*second* push, not the first.

> **🔴 Prompt reinforcement:** SonarCloud is a **post-push** gate that local `lint`/`tsc`/CI-`test` do NOT
> cover, and it re-analyses **every** commit — so after each review-fix push, expect another Sonar pass and
> pre-empt it: no `\s*` adjacent to an alternation (normalize-then-split with string ops, or let chrono
> absorb filler), no `[A-Za-z…]` under `/i`, no `N.0` literals. A regex you add to satisfy one bot can fail
> another. (Memory: `reference_sonarcloud_hotspot_gate_zero_quirk`, `feedback_sonar_s5869_…`.)

### D. 🟢 Don't geocode a venue NAME — the merge distance-sanity guard caught it, but the adapter should prefer the street

The #2223 backfill emitted `location: "KK's Crib"` (venue name) + `locationStreet: "No.5, 1st Cross Street,
Kandawala Road, Ratmalana"`. The merge geocoder geocoded the **venue name** and got a result **4543 km from
the kennel centroid** → its distance-sanity check **skipped** the bad coords (logged
`Geocode validation: "KK's Crib" resolved 4543km from kennel — skipping`), falling back to the Colombo
centroid. No wrong pin shipped — but the better input is the street, not the venue name. Worth noting that
the merge pipeline geocodes `location` (venue) and the address-bearing `locationStreet` is the safer signal.

> **🟢 Note (soft):** when both a venue name and a street address are available, the street is the better
> geocode target; the merge distance-sanity gate is the backstop for a venue-name mis-geocode.

---

## Implementation / process learnings (loop context)

1. **🔴 Worktree path discipline BIT (Gap A)** — relocate-and-revert recovered it; the standing fix is to
   use the worktree-prefixed path from the first edit and `git status` the worktree after edit #1.
2. **🔴 `vitest.config.ts` excludes `**/.claude/worktrees/**`** → `vitest` finds **0 tests** from inside a
   worktree. Ran via a disposable in-worktree `vitest.local.config.ts` (committed config minus that
   exclude), **deleted before commit**. Recurring (Saigon #2 / Phnom Penh #4 / Himalayan #4 / Hanoi #2).
3. **🟢 Fresh-worktree prerequisites are gitignored** — `node_modules` (symlinked to the main checkout),
   `src/generated/prisma` (copied), and `.env` (copied) all had to be wired into the worktree to run
   `tsc`/`vitest`/live-verify; none of them pollute `git status` (all gitignored). `prisma generate` wasn't
   needed (the generated client already existed). Node here is **25 only** (no `fnm`), which satisfies "20+".
4. **🔴 The prod-scrape post-merge step needed *explicit* user authorization** (recurring, Hanoi #7) — "pr
   merged" / "move to post-merge tasks" did the additive seed + backfill, but the live cron `POST` only ran
   after the user said *"please trigger the scrape now."* The prod host is **`www.hashtracks.xyz`**
   (`hashtracks.xyz` → 308 → `www`; `hashtracks.com` → 302; `NEXT_PUBLIC_APP_URL` in `.env` is the local dev
   value).
5. **🟡 Triggering the scrape: prefer the cron endpoint over a local `scrapeSource()` script.** A local
   `npx tsx` calling `scrapeSource()` from `@/pipeline/scrape` failed at import (the pipeline pulls in many
   modules); the authentic trigger is **`POST /api/cron/scrape/<sourceId>` with `Authorization: Bearer
   $CRON_SECRET`** — it runs the real production scrape path and returns the `ScrapeSourceResult` JSON.
   ⚠️ Use a **normal** scrape (no `force` — `force:true` deletes existing RawEvents first, which would drop
   the backfilled #2223).
6. **🟡 For prod read-verification, `psql` beat Prisma-via-`tsx`.** Ad-hoc `prisma.*` read queries from a
   one-shot `tsx` script failed with an empty error in the non-production CLI context; `psql "$DATABASE_URL"`
   against the PascalCase tables (`"Kennel"`, `"Region"`, `"Event"` JOIN `"EventKennel"`) verified every
   record cleanly and needed **no** self-signed flag. (Note: `@/lib/db` uses `ssl:undefined` when
   `NODE_ENV!=="production"`, and the Railway proxy accepted the non-SSL connection — the backfill via
   `@/lib/db` connected without `BACKFILL_ALLOW_SELF_SIGNED_CERT`, unlike `createScriptPool` scripts.)
7. **Merge was a true merge commit, not a squash** — all 4 commits (onboarding + the three review-fix
   follow-ups) landed on `main`; `git log -1 -- <path>` confirmed each file before seeding.
8. **Post-merge `db seed` from freshly-synced `main`, not the merged worktree** — pulled `main` first
   (5 commits = exactly this PR, no concurrent seed PR → no `sources.ts` drift) before seeding
   (`feedback_concurrent_seed_reverts_source_config`).

---

## TL;DR for the research prompt + platform notes

1. **🔴 Unconfirmed-FILLED-DOM onboard → build for BOTH a multi-element and a single-line dash-joined
   render**, lean on the fail-loud guard for the real markup, and **budget a review-fix round** — the
   Gemini/Codex/CodeRabbit pass will probe the constructed surface (month-in-street-as-date, single-line
   venue loss, loose time/minute validation, whole-document map scope were all real).
2. **🔴 SonarCloud re-analyses every commit and is post-push only** — a regex you add to satisfy one reviewer
   can fail Sonar's ReDoS rule on the next push. No `\s*` next to an alternation (normalize-then-split), no
   `N.0` literals; expect a Sonar pass after EACH review-fix push.
3. **🔴 Worktree path discipline** — use the worktree-prefixed absolute path from edit #1 and `git status`
   the worktree to confirm; the Bash cwd reset makes a main-repo path look correct while edits land in
   `main`.
4. **🔴 The prod-scrape step needs explicit user authorization** and runs cleanest via
   `POST /api/cron/scrape/<id>` (no `force`); prod host is `www.hashtracks.xyz`; verify prod reads with
   `psql`, not Prisma-via-`tsx`.
5. **🟢 Prefer the street over the venue name for coords** — the merge distance-sanity gate backstops a
   venue-name mis-geocode (rejected "KK's Crib" at 4543 km → centroid fallback).
6. **Keep:** the placeholder-vs-filled three-way discriminator, `upcomingOnly` + per-run/zero fail-loud,
   `title`-undefined synthesis + `friendlyKennelName` >4-char short-circuit, Maps-**embed** `!2d`/`!3d`
   in-adapter coords + bbox sanity, palette-grep-before-pick (rose verified clear), bare-initialism alias
   discipline, self-host-logo (magic bytes), capture-the-real-DOM when possible (+ a constructed fixture
   when it isn't), the `▶ FOR CLAUDE CODE` directive + ordered post-merge runbook.
