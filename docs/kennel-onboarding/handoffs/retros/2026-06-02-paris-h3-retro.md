# Cowork Handoff Retro — Paris H3 + Sans Clue H3 (France's oldest hash, est. 1981) — 2026-06-02

Feedback from the Claude Code implementation session for the `2026-06-02-paris-h3.md` handoff —
**HashTracks' first 🇫🇷 France kennel(s)**, and a clean example of **two kennels off one Meetup**
source routed by `kennelPatterns` with a non-hash social feed dropped by `silentlySkipPatterns`.
Goal: improve the **research prompt** + **platform notes** so future handoffs need fewer
mid-implementation corrections.

**PR produced:**
- Onboarding (2 kennels + aliases + 1 shared MEETUP source + France COUNTRY/Paris METRO region 5-edit
  + 2 self-hosted logos), config + data only — no new adapter:
  https://github.com/johnrclem/hashtracks-web/pull/1920 (merged)

**Outcome:** Live — both pages serving upcoming runs:
- https://www.hashtracks.xyz/kennels/paris-h3 (Saturdays — R\*n 1134/1136/1137/1138)
- https://www.hashtracks.xyz/kennels/sans-clue-h3 (Sundays — R\*n 1189/1192/1193/1194)

Post-merge scrape: **18 canonical events created, 0 unmatched / 0 blocked / 0 errors** — exactly the
8 Paris H3 + 10 Sans Clue H3 real runs; the **21 "Thursday Night Drinking Club" socials were dropped
pre-RawEvent** by `silentlySkipPatterns` (no `SOURCE_KENNEL_MISMATCH`). Both kennel pages verified to
show real runs with **zero TNDC leakage**.

---

## The loop is working — previous retro fixes LANDED

1. **New-country 5-edit `region.ts` checklist (ONH3 / Mijas retros).** The handoff carried all five
   edits explicitly (REGION_SEED_DATA COUNTRY+METRO, `COUNTRY_INFERENCE_RULES`, `STATE_GROUP_MAP`,
   `COUNTRY_GROUP_MAP`, `COUNTRY_CODE_TO_NAME`) and called out that omitting the inference rule fails
   CI with `inferCountry → "USA"`. Worked — no runtime `inferCountry` failure. *(One new wrinkle inside
   the inference rule itself — the non-ASCII `\b` bug, Gap B below.)*
2. **`aliases.ts` is `Record<string, string[]>` (ZH3 retro #1).** Handoff emitted the real shape.
   Landed.
3. **Region colors: darker country `-200` / lighter metro `-100`, distinct pins, clean numeric
   literals (ZH3 retro #2, #4).** Handoff specified `bg-blue-200/#2563eb` + `bg-blue-100/#3b82f6` and
   `46.6 / 2.4` — no Sonar S6749 trailing-zero, no shared pin. Landed.
4. **Split adapter-only live-verify from the post-merge seed (ZH3 retro #6).** The handoff structured
   it exactly this way — `MeetupAdapter().fetch()` with no DB write pre-PR; `prisma db seed` + scrape
   as a separate post-merge runbook. Landed.
5. **`<ext>` logo placeholder, no pre-filled extension (ah3-nz retro).** Handoff said "confirm via
   `curl -sI` Content-Type + magic bytes." The asset was JPEG (`ff d8 ff`, 600×338); self-hosted
   under both codes. Landed. *(Unlike NSWHHH's Google Sites `sitesv` token, the Meetup CDN `og:image`
   IS fetchable server-side — Gap E note.)*

---

## What the handoff got RIGHT (keep doing)

1. **It overturned its own prior `blocked` mark — correctly.** Paris was marked `blocked` 2026-05-29
   ("Meetup shows 0 upcoming"). The handoff correctly re-diagnosed this as the **SSR-shell hydration
   artifact** (the events-list page renders "Events 0" from a plain fetch) and proved via Chrome
   JS-render that the `__NEXT_DATA__` Apollo state carried 30 live group events. A research prompt that
   can *retract a stale block with evidence* is exactly the self-correcting behavior we want. (It also
   forced a platform-note correction — see below.)
2. **Multi-kennel-off-one-source was modeled on the canonical pattern.** `kennelPatterns`
   (`^Paris H3` / `^Sans Clue H3`, first-match-wins) + **both** codes in `kennelCodes` (source-kennel
   guard) + `kennelTag` fallback — matches the RVA / Melbourne New Moon Meetup precedent. Live-verify
   confirmed clean routing (8 Paris + 10 Sans Clue, 0 UNMATCHED).
3. **`silentlySkipPatterns` for the non-hash social feed — right layer.** The weekly "Thursday Night
   Drinking Club" socials are dropped pipeline-side (`scrape.ts`) before RawEvent creation, not via an
   adapter hack. Verified 21/21 matched at live-verify and 0 leaked into prod.
4. **Alias collision discipline.** Bare `"PH3"` omitted (collides `ph3-my` / `pattaya-h3`), bare
   `"SCH3"` omitted (collides `sch3-atl` / `sch3-ca`), `"SCHHH"` kept. All correct, verified in prod.
5. **`upcomingOnly: true` + "no historical backfill (ZH3 call)".** Correct — Meetup ages past events
   off its window; reconcile would false-CANCEL the recent past runs without the flag.
6. **A concrete, fully-specified sample event corpus** (titles, dates, per-cadence times, hares,
   5 € hash cash, venues) gave an exact oracle the live-verify matched.
7. **`extractRunNumber` deliberately left OFF** — titles use censored `R*n NNNN` (no `#`), so the
   shared `extractHashRunNumber` would be dead config. Correct call; the optional `runNumberPattern`
   knob was offered but flagged not-required, and we didn't ship it.

---

## Handoff GAPS → research-prompt / platform-note improvements (the actionable part)

### A. 🔴 The Meetup platform note cited Paris as a *real* 0-upcoming — it was a FALSE NEGATIVE

`source-platform-notes.md` (Meetup section, written 2026-05-29) used **Paris as the example of a
"real" 0-upcoming/dead-ish case** ("ZH3 *did* have an upcoming run … Paris *which didn't*"). This
onboarding **disproved that**: Paris had 30 live events in Apollo state the whole time; the
2026-05-29 run concluded "0 upcoming" by trusting the SSR-shell counter + the "stale site + past
last-event" heuristic, and that heuristic produced a **false block**. Corrected the platform note:
the only reliable Meetup verification is reading `__NEXT_DATA__` Apollo state (Chrome JS-render);
the "stale-site-implies-dead" heuristic is a tiebreaker that can be wrong, not a substitute.

> **Platform change (done):** retracted the "Paris = real zero" framing; the note now says *always*
> read Apollo state before concluding 0-upcoming, and demotes the stale-site heuristic to a
> last-resort signal that mis-fired here.

### B. 🔴 `\b` before a non-ASCII alias never matches — `\bîle-de-france` silently failed

The handoff's inference rule was `/\b(france|paris|île-de-france|ile-de-france)\b/`. JavaScript's `\b`
only recognizes ASCII word chars `[A-Za-z0-9_]`, so the boundary **before `î` never fires** — and
`name.toLowerCase()` produces exactly the accented `"île-de-france"` that the rule was meant to catch.
The ASCII fallback `ile-de-france` covered the un-accented spelling but not the form `toLowerCase()`
actually yields. Caught by Gemini + the in-CI Claude reviewer; fixed to
`/\b(france|paris|ile-de-france)\b|(?:^|\W)île-de-france\b/`.

> **Prompt/platform change:** when an inference/alias token has a **non-ASCII leading character**
> (accented Latin, etc.), do **not** wrap it in `\b` — use `(?:^|\W)…\b`. First time a non-ASCII metro
> alias appeared in `COUNTRY_INFERENCE_RULES`; flag this whenever a new country's aliases include
> accented forms (Zürich got away with it because the umlaut was mid-token, after `Z`).

### C. 🟡 A medium-confidence `foundedYear` was seeded into the field, not a comment

The handoff flagged Sans Clue's `foundedYear: 1993` as medium-confidence (inferred from a secondary
"25th birthday Apr 2018" mention) **but still put it in the field**. CodeRabbit correctly flagged that
this turns a guess into canonical user-facing metadata. Dropped the field; kept the inference in a
comment for a future confirmer. (Paris H3's 1981 stayed — it's primary-sourced via gotothehash.net.)

> **Prompt change:** "medium/low-confidence" for a structured field like `foundedYear` should mean
> **comment, not field**. Only seed `foundedYear` when primary-sourced; otherwise leave it null with a
> comment recording the inference. (Matches the existing `kimchi-h3` / founder-field conventions —
> uncertain structured data lives in comments until confirmed.)

### D. 🟡 `COUNTRY_GROUP_MAP` only needs the country→country key, not the metro

The handoff said to mirror the **Indonesia** precedent (both `"France":"France"` and `"Paris":"France"`
in `COUNTRY_GROUP_MAP`). The metro key is **unreachable** — `groupRegionsByCountry` resolves a metro
through `STATE_GROUP_MAP` first (`"Paris" → "France"`), then keys `COUNTRY_GROUP_MAP` by the
*state-group* name, never the metro. `/simplify` flagged the dead entry; removed it to match the
**Spain** precedent (which omits it). Indonesia's pairing is belt-and-suspenders, not required.

> **Prompt change:** for a new COUNTRY+METRO, `COUNTRY_GROUP_MAP` needs **only** the country→country
> key; `STATE_GROUP_MAP` carries the metro→country mapping. Cite Spain, not Indonesia, as the model.

### E. `scheduleTime` / `scheduleFrequency` format drift (recurring)

The handoff's paste-ready seed used `scheduleTime: "14:00"` / `scheduleFrequency: "biweekly"`; the
repo convention (across `kennels.ts`) is 12-hour `"2:00 PM"` and capitalized `"Biweekly"`. Converted
on the way in. Minor but recurring — worth pinning in the prompt.

> **Prompt change:** emit `scheduleTime` as 12-hour `"H:MM AM/PM"` and `scheduleFrequency` capitalized
> (`Weekly`/`Biweekly`/`Monthly`), matching the seed-file convention — not 24-hour / lowercase.

---

## Implementation / process learnings (loop context)

1. **`claude-review` failed on a bot-pushed last commit, then cleared on a human push.** The in-CI
   Claude reviewer auto-pushed the `île-de-france` fix (commit `9966c31`); `claude-review` then failed
   purely because the last commit's actor was a bot (known `reference_claude_review_bot_actor_fail`).
   Pushing the `foundedYear` fix (a human-authored commit) turned it green. Not a code defect — don't
   chase it; land a human commit.
2. **Codex adversarial review found no issues; Sonar / Codacy / CodeRabbit all clean** (0 new issues,
   0 hotspots). The two real catches came from Gemini + the in-CI Claude reviewer (the `\b` bug) and
   CodeRabbit (the `foundedYear`); `/simplify` caught the dead `COUNTRY_GROUP_MAP` entry.
3. **Meetup CDN `og:image` IS fetchable server-side** (`image/jpeg`, 200) — unlike the Google Sites
   `sitesv` token that 403s (NSWHHH Gap E). Downloaded via `curl`, magic-byte-verified, self-hosted
   under both kennel codes (shared club image; no distinct Sans Clue logo on `sanscluehash.fr`).
4. **Post-merge runbook ran clean from a fresh `main`, not the stale worktree**
   (`feedback_concurrent_seed_reverts_source_config`): detached-checkout of the merge commit, copied
   prod `.env` into the worktree, `prisma db seed` (Created 2 / Updated 369), re-queried prod to assert
   the source config persisted intact (kennelPatterns + silentlySkipPatterns + upcomingOnly + both
   kennel links), then triggered the prod scrape via the per-source cron endpoint with the Bearer
   `CRON_SECRET`. Removed the temp `.env` afterward (absolute worktree path — `feedback_worktree_bash_cwd_resets_to_main`).
5. **`eventsFound: 18` at the prod scrape = post-silent-skip count.** The 21 TNDC socials never become
   RawEvents (dropped in `scrape.ts`), so they don't appear in the scrape tally at all — `skipped: 0`
   there refers to merge-pipeline skips, a different stage. The 18/18-created, 0-unmatched result is
   the correct signature of a clean multi-kennel + silent-skip source.

---

## TL;DR for the research prompt + platform notes

1. **Always read Meetup `__NEXT_DATA__` Apollo state before concluding 0-upcoming** — the SSR-shell
   "Events 0" is a hydration artifact, and the "stale-site-implies-dead" heuristic gave a *false
   block* on Paris. (Platform note corrected; Paris is no longer the "real zero" example.)
2. **Non-ASCII leading alias chars can't use `\b`** in `COUNTRY_INFERENCE_RULES` — use `(?:^|\W)…\b`.
3. **Seed `foundedYear` only when primary-sourced** — medium-confidence inferences go in a comment,
   not the field.
4. **`COUNTRY_GROUP_MAP` needs only the country→country key** (Spain model), not the metro
   (Indonesia's metro key is dead — `STATE_GROUP_MAP` resolves the metro first).
5. **`scheduleTime` 12-hour `"H:MM AM/PM"`, `scheduleFrequency` capitalized** — match the seed-file
   convention.
6. **Keep**: the `▶ FOR CLAUDE CODE` directive, the false-negative re-diagnosis with evidence, the
   multi-kennel `kennelPatterns` + both-`kennelCodes` + fallback pattern, `silentlySkipPatterns` for
   non-hash social feeds, `upcomingOnly` + "no Meetup backfill", the new-country 5-edit checklist, and
   the `<ext>` logo placeholder.
