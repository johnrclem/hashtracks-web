# Cowork Handoff Retro — Vindobona H3 (🇦🇹 HashTracks' first Austria kennel, est. 25 Apr 1982) — 2026-06-05

Feedback from the Claude Code implementation session for the `2026-06-05-vindobona-h3.md` handoff — a
new `VindobonaH3Adapter` on a **bespoke static club site** (`viennahash.org`: hand-maintained since the
90s, hit counter, framesets-era markup, but two flat HTML target pages) feeding **two** kennels off one
source. Goal: confirm what the handoff nailed (nearly everything) and feed the one genuinely new wrinkle
(a dual-kennel source routed by line prefix) plus the recurring process traps back into the loop.

**PR produced:**
- Onboarding (new adapter + 18 tests + 2 kennels/aliases/source seed + first-Austria region):
  [PR #2017](https://github.com/johnrclem/hashtracks-web/pull/2017) (merged). Three commits on-branch:
  onboard → review fixes (österreich regex + zero-guard + prefixed run cell + GPS validation) → Sonar
  cleanups.

**Outcome:** Live. Post-merge runbook ran clean from the MAIN repo on `main`: seed (Created 3 /
Updated 377), then a forced `scrapeSource(id, {force:true})` published **11 canonical events** — Vindobona
H3 ×10 (#2363 2026-06-08 → #—/#—/Dec-13) + Vienna FMH3 ×1 (2026-08-01), all `CONFIRMED`, `lastEventDate`
set on both kennels. The next run `#2363` carries its enriched detail exactly as the handoff sample
promised: `18:30`, `Kaiserzeit Würstelstand, Augartenbrücke, 1020 Wien`, GPS `48.21903 / 16.37094`. Every
verbatim oracle (the `FMH #30?` / `Hash #23??` rows → `runNumber` undefined, the apex-not-www trap, the
N/E GPS line) held byte-for-byte against the live site.

---

## The loop is working — previous retro fixes LANDED

1. **`upcomingOnly` on a rolling forward hareline (ONH3/Brasília/bmh3-bkk).** Source
   `config.upcomingOnly:true` keeps reconcile scoped to future dates so aged-off runs aren't
   false-cancelled as the receding hareline prunes them. Specified in the handoff, landed, asserted.
2. **Alias-collision discipline (Asunción/Brasília/bmh3-bkk).** Bare `"VH3"` / `"vh3"` correctly
   **omitted** (owned by Victoria H3, BC); bare `"FMH"` omitted (too generic). kennelCode `vindobona-h3`
   chosen for exactly this reason. The dedup even caught the sitemap's `*vh3*` matches (`cvh3`, `hvh3-ny`,
   `lvh3`, …, `vh3`=Victoria) as a false-positive trap and called it out in research.
3. **ASCII shortName → no slug override.** `shortName: "Vindobona H3"` → `toSlug` = `vindobona-h3`;
   both shortNames are >4 chars so `friendlyKennelName` returns them verbatim → titles synthesized as
   `"Vindobona H3 Trail #N"` / `"Vienna FMH3 Trail #N"`. Confirmed via the handoff's one-liner before
   writing code.
4. **`title` left undefined; merge synthesizes.** No theme titles on this source; the adapter never sets
   `title` and never promotes hares or a run-type note ("Sunday run") to it. Held across all 11 events.
5. **Self-host the logo + confirm via magic bytes (self-host-unstable-logos).** Both logos downloaded and
   verified: `vindobona-h3.png` (PNG magic `89 50 4E 47`, downscaled 9229×5050 → 600×328 to keep the
   commit small) and `vienna-fmh3.jpg` (JPEG `FF D8` — the handoff *guessed* `.png`; magic bytes said
   JPEG, so `logoUrl` ends `.jpg`). The "never pre-fill the extension" rule paid off again.

---

## What the handoff got RIGHT (keep doing)

1. **The dual-surface structure was front-and-center.** "Fetch `futureruns.html` for the backbone AND
   `schedule.html` for the next-run detail; merge by run number." The adapter shape was right on the first
   pass — it is structurally `bangkok-monday-hash.ts` minus the year inference.
2. **The apex-not-www trap was a 🔴 up front.** "Use the bare apex `viennahash.org`; `www.` returns an
   empty body." Seeded and fetched the apex; live verify worked first try. This is the kind of
   environment gotcha that costs an hour if discovered at implementation instead of stated in research.
3. **Run-number hygiene was specified precisely.** "Store `runNumber` only for a clean `#\d+`; reject
   `#30?` / `#23??` → undefined, still emit the dated event." `extractHashRunNumber` already does exactly
   this (its delimiter lookahead rejects trailing `?`), so the rule mapped straight onto an existing
   shared helper — no new regex.
4. **Field-fill assertion table set correct expectations.** startTime 1/11 (only the enriched next run),
   location 3/11, hares 8/11, coords 1/11 → centroid fallback for the rest. No default-pin trap; the
   single real GPS pin was the only coordinate emitted.
5. **Sibling sweep done in research, not deferred.** Vienna Full Moon HHH included as `vienna-fmh3` via
   `FMH #`-prefix routing on the *same* source; Blue Moon / New Moon correctly excluded (ad-hoc, no
   cadence). One source, `kennelCodes: ["vindobona-h3","vienna-fmh3"]`, fail-loud per-kennel zero guard.
6. **The 5-edit region.ts checklist was spelled out** (Austria COUNTRY + Vienna METRO, teal palette, all
   five maps named) — first-Austria onboard with zero region guesswork.

---

## Handoff GAPS → research-prompt / platform-note improvements (the actionable part)

This handoff was unusually complete; the gaps are minor and mostly "a reviewer caught a latent edge,"
not "research missed something."

### A. 🟡 The dual-kennel zero-guard must measure the RAW parse, not the date-windowed subset

The handoff correctly asked for a "per-kennel fail-loud zero guard," but the first implementation checked
the *date-windowed* event list. Gemini + claude-review both flagged it: a narrow `options.days` could
empty the window on a perfectly healthy parse and false-fire "markup drift" → suppress reconcile. Fixed to
measure the raw `events` array (parse success), independent of the window.

> **Prompt / platform change:** when a handoff calls for a "parsed 0 rows" drift guard, specify that it
> runs on the **raw parse count**, never the post-`buildDateWindow` subset — the guard answers "did the
> page parse?", which is orthogonal to "is anything inside the requested window?".

### B. 🟡 Schedule-page run-number cell may be bare OR prefixed — match leniently

The detail page's Run No. cell is bare `#2363` today (live-verified), but Codex flagged that the same
site elsewhere writes `Hash #2363` / `Full Moon Hash #299`. An exact `^#\d+$` predicate would silently
drop enrichment if the cell shape rotated. Switched run-cell detection to `extractHashRunNumber` (matches
either form, and no other cell in the run row carries a `#NNN`). *(Codex's premise — that the live page
already uses the prefixed form — was factually wrong; the value was in the hardening, not the claim.
Worth separating "is this reviewer's premise true?" from "is the change still worth making?")*

> **Prompt change:** for any "find the run-number cell" step in a multi-cell detail table, prefer the
> shared `extractHashRunNumber` (substring `#NNN` match) over an anchored `^#\d+$` — it absorbs an
> optional label prefix for free.

### C. 🟡 N/E decimal coords have no shared parser AND no range validation by default

The handoff correctly said to parse `N<lat>, E<lng>` locally (`extractCoordsFromMapsUrl` won't match a
non-URL pin). But the first pass wrote the parsed lat/lng straight onto the event with no range check —
every *other* coord path in `geo.ts` gates on `isValidCoords`. My own `/code-review high` caught it; a
dropped-decimal pin (`N4821903`) would otherwise write latitude 4821903. Added the `isValidCoords` guard.

> **Prompt / platform change:** whenever an adapter parses coordinates from free text (not via a
> `geo.ts` helper), require an explicit `isValidCoords(lat,lng)` gate before assignment — the helpers do
> this for you, hand-rolled regexes don't. (A shared `parseDecimalCardinalCoords` in `geo.ts` is a
> reasonable future refactor: this is the 2nd decimal-cardinal parser, after the GCal suffix form.)

### D. 🟢 The €5 `hashCash` was in the metadata but missing from the ready-to-paste seed block

The handoff's metadata clearly stated `hashCash: "€5"`, but the copy-paste kennel block omitted it. Easy
to catch by diffing the prose-metadata against the seed block. Added it to both kennels.

> **Prompt change:** the ready-to-paste seed block should be a *superset* of the prose metadata — when
> generating it, assert every metadata field with a `KennelSeed` column (hashCash, founded, socials) is
> actually present in the block.

---

## Implementation / process learnings (loop context)

1. **🔴 Worktree cwd trap AGAIN — the region.ts edits first landed in the MAIN checkout.** Same recurrence
   as bmh3-bkk: the env's primary dir is the worktree, but the first `Edit`/`Read` calls used main-repo
   absolute paths, so all five region.ts edits wrote to `/hashtracks-web/src/lib/region.ts` on `main`.
   Caught it when a worktree-relative `grep Austria` returned 0 while the edits "succeeded." Recovery this
   time was clean and fast: `git -C <main> diff > patch`, `git -C <main> checkout -- region.ts` (the diff
   was provably *only* my Austria additions, so the main checkout's unrelated uncommitted doc edits were
   untouched), then `git apply` the patch in the worktree. **Standing reminder (5th+ recurrence): in a
   worktree, prefix every Write/Edit path with the worktree root, and verify the first edit with a
   worktree-relative `grep` before trusting "success."**
2. **The Read tool can show a different checkout than Bash `grep`.** During the trap, the Read tool (main
   repo path) and Bash `grep` (worktree cwd) disagreed on line numbers by a few lines — that *was* the
   tell that two checkouts were in play. When line numbers from Read and grep don't line up, suspect a
   path/cwd split before suspecting a stale file.
3. **tsx live-verify in a worktree needs `npx prisma generate` once** (gitignored `@/generated/prisma`),
   and top-level `await` fails under tsx's cjs transform → wrap in an `async function main(){…}; main()`.
   Node 25 again (no `fnm` on PATH; 25 satisfies Prisma 7's "20+").
4. **`/code-review high` earned its keep before pushing.** It surfaced the missing `isValidCoords` gate
   (gap C) that no external bot flagged, and correctly *declined* the speculative "venue in a separate
   cell" finding once the live HTML confirmed venue+GPS share one `<td>`. Running the self-review pre-push
   meant the external bots had only minor cleanups left.
5. **Sonar new-code issues fixed at SOURCE, 2 → 0, no NOSONAR.** S7755 (`cells.at(-1)` over
   `cells[len-1]`) + S7735 (positive `if (page.ok)` with the fetch-error branch in `else`). Codacy 0,
   SonarCloud gate green on the re-analysis.
6. **Distinguished a reviewer's wrong premise from a worthwhile change (Codex, gap B)** and **declined a
   wrong style nit with a reason** (claude-review's "scheduleTime should be 24h" — 12-hour `"6:30 PM"` is
   the established convention for the legacy flat field; only `scheduleRules.startTime` is 24h, per
   `zh3`'s `"7:00 PM"`). Reply-and-resolve only the threads actually acted on.
7. **Post-merge ran from the MAIN repo on `main`** (node_modules + generated client + prod `.env` →
   Railway). The scrape's post-write `after()` IndexNow ping + `revalidateTag` throw "outside request
   scope" when run via a one-shot tsx — **expected and harmless** (they fire after the DB writes; the
   events are fully persisted). The hareline cache refreshes on its ISR cycle.

---

## TL;DR for the research prompt + platform notes

1. **Dual-kennel-by-line-prefix is a clean pattern** — one HTML source, `kennelCodes: [...]`, route rows
   by a label prefix (`Hash #` vs `FMH #`), per-kennel fail-loud zero guard. Worth a platform-note
   sentence so the next multi-kennel static site reuses it instead of inventing a second source.
2. **Drift "0 rows" guards measure the RAW parse**, never the date-windowed subset.
3. **Run-number cells: match with `extractHashRunNumber`, not anchored `^#\d+$`** — absorbs an optional
   label prefix.
4. **Hand-rolled coordinate parses need an explicit `isValidCoords` gate** — the `geo.ts` helpers do it;
   a local regex doesn't.
5. **The ready-to-paste seed block must be a superset of the prose metadata** (the €5 `hashCash` gap).
6. **Keep:** the dual-surface fetch-and-merge framing, the 🔴 apex-not-www environment flag, run-number
   hygiene mapped onto the shared helper, the field-fill assertion table, the sibling sweep, and the
   spelled-out 5-edit first-country region checklist — all landed first-try.
