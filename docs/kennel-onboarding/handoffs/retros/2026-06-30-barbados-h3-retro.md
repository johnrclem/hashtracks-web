# Cowork Handoff Retro — Barbados H3 (🇧🇧 first Barbados / first Caribbean kennel) — 2026-06-30

Feedback from the Claude Code implementation session for the `2026-06-28-barbados-h3.md` handoff — a
**config-only HARRIER_CENTRAL** onboard (the `HarrierCentralAdapter` already exists; zero new adapter
code) for a very active 40-year-old island-wide hash flowing through Harrier Central. This was a clean
config run where **every metadata field held** and the predicted source shape was exactly right, but it
was unusually productive downstream: the four review bots caught **two genuine data-quality bugs in the
historical backfill**, and the onboarding **surfaced a latent gap in the #1390 multi-cadence
ScheduleRule feature** (same-day seasonal rules silently collapse) that became its own fail-loud-guard
PR. The one durable lesson — model same-day seasonal splits with disjoint `BYMONTH`, not
`validFrom/validUntil` — is now baked into a guard so it can't recur.

**PRs produced:**
- Onboarding (HC config source + first-Caribbean 5-edit `region.ts` + kennel/alias seed + self-hosted
  PNG logo + 212-run backfill): [PR #2463](https://github.com/johnrclem/hashtracks-web/pull/2463)
  (merged). **Three commits** — onboard base, then two review-driven backfill data fixes (drop an
  off-island geocode-fail pin on #2162, drop an implausible 22:00 holiday `startTime` on #2137).
- Enhancement (fail-loud guard for colliding same-rrule `SEED_DATA` scheduleRules + Barbados as the
  correct `BYMONTH` same-day-seasonal exemplar): [PR #2470](https://github.com/johnrclem/hashtracks-web/pull/2470)
  (merged). Surfaced BY this onboarding; see gap #1.
- Docs (this retro + run-log/queue → SHIPPED, plus the bundled Algarve H3 handoff WIP): this PR.

**Outcome:** Live at `https://www.hashtracks.xyz/kennels/barbados-h3` — **216 canonical events** (212
backfilled history **#2127 @ 2023-02-04 → #2338 @ 2026-06-27** + 4 upcoming **#2339–#2342, Sat 16:00**),
weekly Saturday, `#2342` title correctly synthesized to "Barbados H3 #2342" (the source's malformed
"Barbados H3 Run#"). Post-merge ran from an **isolated worktree detached at `origin/main`** (never the
main repo, which held unrelated Algarve doc WIP): a **targeted** seed (scoped `seedKennels` to the
Barbados subset — NOT a full `db seed`, which would have reverted other sources' prod `config`), then
`BACKFILL_APPLY=1` backfill (**created=212, 0 errors, 0 blocked**), then `POST /api/cron/scrape/<id>`
with the Bearer `CRON_SECRET` (**eventsFound 4 / created 4 / cancelled 0** — `cancelled=0` proves the
`upcomingOnly` contract). After the guard PR merged, the prod scheduleRules were reconciled to the two
`BYMONTH` rows (Summer 16:00 / Winter 15:30), and the page now shows the correct current-season time.

---

## The loop is working — previous retro discipline LANDED

1. **Live-verify END-TO-END before CI.** `adapter.fetch(source)` against the live HC feed returned all
   4 upcoming runs — `kennelTags:["barbados-h3"]`, `startTime "16:00"`, run numbers correct (incl. 2342
   from `EventNumber` despite the malformed name), `#2342` → "Barbados H3 #2342". #2341's real venue
   (Oldbury Park) carried a legit St-Philip pin; the 3 TBD venues carried none → no default-pin trap.
2. **Targeted post-merge seed, NEVER a full `db seed`.** The seed's source loop overwrites `config` on
   every existing source whose seed-data differs (seed.ts:407) — a blanket seed would revert any other
   source's prod-only config drift. Scoped the tested `seedKennels` to the Barbados subset only; other
   sources untouched. [post-merge-config-to-prod-targeted / concurrent-seed-reverts-source-config]
3. **Isolated worktree, never the main repo.** All prod writes ran from a worktree at `origin/main`; the
   main repo's unrelated Algarve doc WIP was left intact. [worktree-bash-cwd-resets-to-main]
4. **HC history via the `global-runs` past-window pull.** Rediscovered the signature the handoff
   couldn't re-confirm: `?isFuture=0&minEventDate=&maxEventDate=` (both dates REQUIRED), walked in
   6-month windows, filtered client-side on `PublicKennelId`. Archive begins at #2127 (Feb 2023 — HC
   join-forward, not the 1985 founding). [hc-global-runs-past-backfill]
5. **Worktree vitest exclude workaround + `set -a && source .env` for tsx DB probes** — both recurred
   and behaved exactly as the prior retros documented.

---

## What the handoff got RIGHT (keep doing)

1. **Config-only HC, GUID-filtered, every metadata field held** — `publicKennelId`, `defaultKennelTag`,
   `defaultTitle`, `staleTitleAliases`; foundedYear 1985 (40th-anniv source), hashCash BDS $4, Sat
   weekly, FB + IG, walkers-welcome — all shipped as written.
2. **The first-Caribbean 5-edit `region.ts` checklist was complete and correct** — Barbados COUNTRY +
   Bridgetown METRO (fuchsia, `America/Barbados`), `STATE_GROUP_MAP`, `COUNTRY_GROUP_MAP`,
   `COUNTRY_CODE_TO_NAME`, and crucially `COUNTRY_INFERENCE_RULES` (`barbados|bridgetown`). The
   inference rule is the silent-USA-routing trap; the handoff flagged it, and a disambiguation test
   locks it.
3. **Coord handling was auto-correct.** The adapter's `dropApiCoords`/`hcGeocodeFailed` drops HC
   region-default pins on the *live* path; the upcoming TBD venues carried no coords, the one real
   venue carried a real pin. (The *backfill* path needed its own guard — gap #2.)
4. **`staleTitleAliases` for the malformed `#2342`** ("Barbados H3 Run#" with no number) → synthesized
   "Barbados H3 #2342" via `defaultTitle`; the generic "Barbados H3 Run#NNNN" names pass through, which
   is acceptable and matches Lisbon/Porto.
5. **kennelCode / alias hygiene** — `barbados-h3` (bare `bh3` = Boulder/Buffalo taken → descriptive
   code), bare "BH3" alias omitted. The HC `KennelIANATimezone: America/La_Paz` quirk was correctly
   called harmless (≡ `America/Barbados`, both UTC−4 — and the adapter never reads it; merge composes
   UTC from the Bridgetown METRO zone).

---

## Handoff GAPS → research-prompt / platform-notes improvements (the actionable part)

1. **🔑 NEW LESSON — same-day seasonal `scheduleRules` collapse on the `(kennelId, rrule, source)`
   upsert key.** The handoff (mirroring LBH3) proposed two `FREQ=WEEKLY;BYDAY=SA` rules differing only
   by `startTime`/season. But LBH3 splits seasons by *weekday* (Thu↔Sun) — for a **same-day** kennel the
   two rules share an rrule and the second silently overwrites the first, leaving the wrong season's
   time on the page. Barbados was the only kennel in the whole seed to hit this. Fix (Codex's insight,
   verified end-to-end): make the rrules distinct with disjoint **`BYMONTH`** (summer `5,6,7,8,9,10` /
   winter `11,12,1,2,3,4`) — `parseRRule` + `generateOccurrences` honor `BYMONTH`, so summer/winter
   partition all 52 Saturdays exactly once, each projecting its own time. Shipped a **fail-loud guard**
   in `planSeedRule` (throws on same-`(kennelId, rrule, SEED_DATA)`) + a seed-data invariant test
   ([PR #2470](https://github.com/johnrclem/hashtracks-web/pull/2470)) so this can never silently
   recur. Memory `reference_seasonal_static_schedule_needs_schedulerules` already said "same-day
   seasons keep BYMONTH" — the miss was deviating to the LBH3 `validFrom/validUntil` pattern.
   → **Research-prompt add:** for a same-day seasonal kennel, specify `BYMONTH`-distinct rrules (not two
   bare-`BYDAY` rules); anything a weekly rrule can't express (public-holiday times) goes in
   `scheduleNotes`.
2. **HC `global-runs` PAST rows carry region-default geocode-fail pins on real venues.** Run #2162
   ("MIle & a Quarter pavillion", St Peter, Barbados) came back with **Tokyo/Roppongi coords
   `35.66, 139.73`** — HC's fallback pin. The live adapter's `dropApiCoords` doesn't run on the backfill
   path, so the extractor needs its own guard: a **country bounding-box** filter (drop lat/lng outside
   Barbados → merge re-geocodes from venue text). Both Gemini and Codex caught it. → **platform-note +
   memory `hc-global-runs-past-backfill`.**
3. **HC past archives contain AM/PM `startTime` typos.** #2137 (Easter-Monday holiday, should be 10:00)
   was stored at **22:00**; #2128 at **03:30** amid 15:30 neighbours. Kept only plausible hash hours
   (`06:00`–`20:00`) and **dropped** out-of-range rather than fabricate a corrected time (preserves the
   legit 10:00 holiday + 19:00 evening runs). Codex caught the 22:00. → same platform-note.
4. **SonarCloud "former-hotspot" mis-attribution can fail a green PR.** `S5332` ("http:// is insecure")
   on a **pre-existing** kennel `website` line (`atlantahash.com`, authored weeks earlier, NOT in the PR
   diff) dropped the PR's *new-code* Security Rating to B — purely because the rule was reclassified
   hotspot→vulnerability and the PR touched that file. Resolved by marking it accepted/won't-fix via the
   `api/issues/do_transition` REST (`transition=accept`) — the `mcp__sonarqube__markIssueWontFix` tool
   mis-mapped its `issue_key` param, so the REST fallback is the reliable path. → **platform-note:** a
   red SonarCloud gate on a file you merely touched may be a pre-existing former-hotspot; check the
   blame + PR diff before "fixing" unrelated code, and resolve via REST.
5. **The optional backfill was worth taking.** The handoff defaulted to "lean future-only" for a
   first-Caribbean config-only kennel; the user opted into history. It landed cleanly (212 continuous
   runs, 0 missing numbers) once the past-window param was rediscovered — deeper than the handoff's
   ~130 estimate. `upcomingOnly:true` is REQUIRED whenever the backfill ships (the Bandung contract).

---

## Net

A config-only onboarding that punched above its weight: the research held and the source shape was
exactly as predicted, but the work surfaced a **latent same-day-seasonal gap in the multi-cadence
ScheduleRule feature** (now guarded + fixed with the correct `BYMONTH` idiom) and hardened the HC
`global-runs` backfill against two real data-quality traps (off-island fallback pins, AM/PM time
typos). First Barbados / first Caribbean kennel is live with 40 years of HC-join-forward history and
accurate seasonal times. The durable lesson — same-day seasons use `BYMONTH`, and the seed now *fails
loud* if you forget — is a reusable guard for the next such kennel.
