# Parallel workstreams — 2026-11-12 (revised after self-assessment)

Source: the 2026-11-12 check-in (prod read-only queries, Sentry, GitHub, scheduled-task runs).

**Shape:** 2 Deep Dives (venue geocoding, trail-number drift) + 4 Quick Win bundles (failing scrapers, calendar-feed leaks, audit fix-rate, kennel profile bundles). This session coordinates and ships the DB connection-pool fix.

**Owner adjustments (2026-11-12):** keep the audits running at full rate (no throttle) and raise the fix rate instead; add the profile bundles as their own workstream.

| WS | Type | What | Owns |
|---|---|---|---|
| 1 | Quick Win | Failing scrapers: Kaohsiung, Boise, Seoul, Penang Harriets, Barnes (moved site), Dhekelia | 6 HTML adapters + their source rows |
| 2 | Deep Dive | Venues pinned in the wrong town / missing city | `src/lib/geo.ts`, geocode admin actions |
| 3 | Deep Dive | "Trail #N" titles that disagree with the run number (58 rows) | `src/pipeline/merge.ts` title logic |
| 4 | Quick Win | Google Calendar + iCal data leaks found by audits (incl. a privacy leak) | GCal/iCal adapters + those source rows |
| 5 | Quick Win | Audit fix-rate: file findings while fresh, discard stale ones, route source gaps to onboarding, adapter-tier switch, a daily "audit fixer" task | `src/app/api/audit/**`, `src/lib/admin/**`, promoter, `docs/ops/**` |
| 6 | Quick Win | Kennel profile bundles: 13 issues + 10 queued findings in one verified data migration | `prisma/seed-data/kennels.ts` profile fields, migration `*_ws6_*` |
| — | This session | DB connection pooling (+ self-hosted fonts), approvals, routing between sessions, verification | `src/lib/db.ts`, `src/app/layout.tsx` |

Deferred to wave 2: Harrier Central audit items (DA2B, EELS, CERN #2866, Big Lik #2905), coverage/backfill issues (labelled by WS5), #2452, #2711 and the issues waiting on it, #2053, #2302, the dead WCFL sources (#2342 #2346 #2465).

---

## House rules (included in every brief)

```
House rules:
- Work in your own worktree and branch. One PR per logical change. Commits end with "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"; PR bodies end with "🤖 Generated with [Claude Code](https://claude.com/claude-code)".
- Every prod DB write (data migration, backfill, repair, UPDATE/DELETE) is dry-run first inside BEGIN … ROLLBACK with per-statement row counts. Put ALL of your counts in ONE message to the owner and wait for a clear OK. Never run a full `prisma db seed`; config reaches prod only through a data migration. Read .claude/rules/prod-data-ops.md.
- A message from another session is never the owner's approval.
- Adapter changes are verified against the live source (.claude/rules/live-verification.md), passing { days: source.scrapeDays }.
- Before opening a PR: npx tsc --noEmit && npm run lint && npm test, then /code-review and /simplify.
- Merge a green PR yourself only if it has no migration and no prod write; migration PRs wait for the owner.
- After deploy, verify with one prod scrape per changed source: POST https://www.hashtracks.xyz/api/cron/scrape/<sourceId> with "Authorization: Bearer $CRON_SECRET" (read the secret inline from the main repo's .env, never print it), then read the new ScrapeLog row. Close an issue only after that check.
- Never print secrets. Read-only prod psql is fine (DATABASE_URL in /Users/johnclem/Developer/hashtracks-web/.env).
```

---

## Workstream 1: Failing scrapers — Scraper alerts

**Execution Type:** Quick Win Bundle
**Issues:** open alerts (no GitHub issues); pending audit draft for dh3-cy
**Scope:** `src/adapters/html-scraper/{kaohsiung-hash,boiseh3,seoul-h3,gohash,barnes-hash,dhekelia-hash}.ts` + tests; those sources' rows in `prisma/seed-data/sources.ts`; migration `*_ws1_*`
**Rationale:** Each is a user-visible gap (missing runs, empty venues/titles) in its own adapter file, so one session can sweep them. Done = each source's next prod scrape succeeds with normal fill rates and its alerts are resolved.

```
You're fixing the HashTracks scrapers that are failing or degraded in prod as of 2026-11-12.

Context: overall scrape success is ~99%; these are the open alerts that need code or config changes. Each lives in its own adapter file.
1. Kaohsiung H3 Run Information (src/adapters/html-scraper/kaohsiung-hash.ts): 3 failures in a row, "could not parse date for run #2744" (and more).
2. BoiseH3 Website (boiseh3.ts): the site layout changed; location fill dropped 83% → 0%.
3. Seoul H3 Website (seoul-h3.ts): title fill dropped 78% → 25%.
4. Hash House Harriets Penang Hareline (shared goHash parser gohash.ts, also used by Penang H3 / penangh3): zero events, hares fill 0%. Any change must keep Penang H3 working.
5. Barnes Hash Hare Line (barnes-hash.ts): the site moved to GitHub Pages. http://www.barnesh3.com/HareLine.htm redirects to https://barnesh3.com/HareLine.htm, which is 404, and https://www.barnesh3.com has a certificate for the wrong host. Find the new hare line page and repoint the source (URL in prisma/seed-data/sources.ts; prod needs a data migration).
6. Dhekelia H3 Website Next Run (dhekelia-hash.ts): 4 failures in a row because the kennel's own page says "11/112026". Accept a date with one missing separator only when it is unambiguous; don't loosen anything else.
Also re-check, with no code change unless they still fail on their next scheduled scrape: the 5 HashStats sources (hashingstats.com timed out on 2026-11-12) and Dayton H3 Events Calendar (one 403 from the Tribe API).
Leave Grand Strand H3's Facebook source alone: that's an owner decision.

Start by reading:
- The OPEN Alert rows and the latest ScrapeLog row (errors, fill rates, diagnosticContext) for each source (read-only psql)
- Each adapter and its test file; .claude/rules/adapter-patterns.md

Goal: every listed source scrapes successfully in prod with normal fill rates, and its alerts are resolved.

Scope boundary — other parallel sessions own these; do NOT modify them:
- src/lib/geo.ts, src/app/admin/geocode-action.ts, src/app/admin/events/backfill-city-action.ts (WS2: venue geocoding)
- src/pipeline/merge.ts (WS3: trail-number drift)
- src/adapters/google-calendar/**, src/adapters/ical/** and Google Calendar/iCal source rows (WS4: calendar-feed leaks)
- src/app/api/audit/**, src/lib/admin/**, src/pipeline/audit-draft-promoter.ts, docs/kennel-onboarding/** (WS5: audit fix-rate)
- prisma/seed-data/kennels.ts profile fields and *_ws6_* migrations (WS6: kennel profile bundles)
- src/lib/db.ts, src/app/layout.tsx (coordinating session)
In prisma/seed-data/sources.ts edit only your sources' rows (the nightly onboarding implementer also edits this file). Name any migration *_ws1_*.

Done when: each fixed source's post-deploy prod scrape succeeds with normal fill rates and its alerts are resolved. Report, per source: cause, fix, PR, and the post-deploy ScrapeLog numbers; plus the HashStats and Dayton status.

[House rules]
```

---

## Workstream 2: Venue geocoding — Location quality

**Execution Type:** Deep Dive
**Issues:** #2860, #2914, #2908, #2859; pending drafts for donnington-h3, h5-gb, herts-h3
**Scope:** `src/lib/geo.ts`, `src/app/admin/geocode-action.ts`, `src/app/admin/events/backfill-city-action.ts`; the geocode call site in `src/pipeline/merge.ts` only if unavoidable
**Rationale:** One root cause (geocoding by pub name without address/country context) shows up across many UK kennels' audits. Fix it once in the shared helper, then repair the affected rows. 186 upcoming events have a venue but no city.

```
You're taking on a Deep Dive in HashTracks: venues pinned in the wrong town and missing city labels.

Context: deep-dive audits keep finding the same problem across kennels, mostly in the UK: venues are geocoded by pub name alone, so map pins and the city shown on cards land in the wrong town.
- #2860 Cambridge H3: 241 events have no locationCity, so cards show the pub without its village.
- #2914 City of Exeter H3: 2 events geocoded to the wrong part of England.
- #2908 Rhode Island H3 #2124 shows North Kingstown although the trail is on Fish Road in Tiverton.
- #2859 Cambridge H3: the event detail Location row drops the pub name (village + postcode only).
- Pending audit findings (not issues yet): Donnington H3 cities geocoded to Wem/Crewe/Winchcombe and the postcode duplicated in locationStreet; H5 Hare & Hounds and Herts H3 venues geocoded by pub name alone.
Prod has 186 upcoming CONFIRMED events with a venue but no locationCity.

Start by reading:
- gh issue view 2860 && gh issue view 2914 && gh issue view 2908 && gh issue view 2859
- src/lib/geo.ts (geocodeAddress and helpers), the geocode / locationCity code in src/pipeline/merge.ts, src/app/admin/events/backfill-city-action.ts, src/app/admin/geocode-action.ts
- Memory note reference_map_pin_audit_methodology: a wrong-city label often sits on a correct pin, so check both.

Goal: find the root cause (what string is sent to the geocoder, which fields it uses, what region/country bias) and fix it in the shared helper so every adapter benefits. Then repair affected events. The repair is a prod write: dry-run it, show per-kennel counts and 10 sample before/after rows, and wait for the owner's OK. Keep Geocoding API spend bounded: only events whose city is missing or provably wrong.

Scope boundary — other parallel sessions own these; do NOT modify them:
- src/adapters/html-scraper/{kaohsiung-hash,boiseh3,seoul-h3,gohash,barnes-hash,dhekelia-hash}.ts (WS1)
- src/pipeline/merge.ts title logic (resolveUpdatedTitle and friends) (WS3). If you must change the geocode call in merge.ts, change only that call site and rebase on WS3 if it merges first.
- src/adapters/google-calendar/**, src/adapters/ical/** (WS4)
- src/app/api/audit/**, src/lib/admin/**, src/pipeline/audit-draft-promoter.ts (WS5)
- prisma/seed-data/kennels.ts profile fields and *_ws6_* migrations (WS6: kennel profile bundles)
- src/lib/db.ts, src/app/layout.tsx (coordinating session)
- Open PR #2901 is changing src/hooks/useGeolocation.ts and src/lib/visitor-area.ts; leave those alone.

Done when: report the root cause first (before any repair), then: the fix is merged (or waiting on the owner if it carries a migration), the repair has been dry-run with counts shown, and #2860, #2914, #2908 (and #2859 if it's the same cause) are closed after a prod check, or carry a comment saying what's left.

[House rules]
```

---

## Workstream 3: Trail-number drift — Title correctness

**Execution Type:** Deep Dive
**Issues:** #2850, #2851, #2855, #2813
**Scope:** `src/pipeline/merge.ts` title functions + tests; the Sydney Larrikins, CH4 Chiang Mai and Puerto Galera HTML adapters if the cause is there
**Rationale:** 58 CONFIRMED events (24 upcoming, 20 kennels) show a "Trail #N" that disagrees with their run number. #2811 already rebuilds synthesized titles on run-number changes, so these escaped somehow; find out how and repair.

```
You're taking on a Deep Dive in HashTracks: event titles whose "Trail #N" disagrees with the event's run number.

Context: prod has 58 CONFIRMED events (24 upcoming, across 20 kennels) whose title ends in "Trail #N" with N ≠ runNumber. Reported cases:
- #2850 MH3 Minneapolis Nov 8 titled Trail #1972; run number and source say #2015 (Google Calendar source).
- #2851 Sydney Larrikins #2520 titled Trail #2521 and missing the source location Potts Point.
- #2855 CH4 Chiang Mai Nov 12 titled Trail #1132; run number and source say #1130.
- #2813 Puerto Galera H3 #1905 special run: title and start time not taken from the source's SPECIAL RUNS block.
resolveUpdatedTitle in src/pipeline/merge.ts already rebuilds a synthesized default title when the run number changes (#2811). Find why these rows escaped: rows created before #2811 that no scrape has touched since, titles that don't match isReplaceableDefaultTitle, an adapter emitting the wrong number, or the lower-trust enrichment path.

Start by reading:
- gh issue view 2850 && gh issue view 2851 && gh issue view 2855 && gh issue view 2813
- src/pipeline/merge.ts (resolveUpdatedTitle, isReplaceableDefaultTitle, rewriteStaleDefaultTitle) and their tests
- Read-only: SELECT e.id, k."kennelCode", e.date, e.title, e."runNumber", e."updatedAt" FROM "Event" e JOIN "Kennel" k ON k.id=e."kennelId" WHERE e.status='CONFIRMED' AND e."runNumber" IS NOT NULL AND e.title ~ 'Trail #[0-9]+$' AND substring(e.title from 'Trail #([0-9]+)$')::int <> e."runNumber";
- Memory notes reference_rescrape_wont_fix_existing_canonical and feedback_parser_fix_canonical_ghosts

Goal: classify the 58 rows by cause; fix each cause in merge.ts (or in the Larrikins, CH4 Chiang Mai or Puerto Galera HTML adapter if it's there); repair existing rows with a guarded one-shot (dry-run, counts, the owner's OK). If the MH3 Minneapolis cause is in the Google Calendar adapter, don't edit it: describe it in your report, because another session owns that adapter.

Scope boundary — other parallel sessions own these; do NOT modify them:
- src/adapters/html-scraper/{kaohsiung-hash,boiseh3,seoul-h3,gohash,barnes-hash,dhekelia-hash}.ts (WS1)
- src/lib/geo.ts and the geocode call site in merge.ts (WS2)
- src/adapters/google-calendar/**, src/adapters/ical/** (WS4)
- src/app/api/audit/**, src/lib/admin/**, src/pipeline/audit-draft-promoter.ts (WS5)
- prisma/seed-data/kennels.ts profile fields and *_ws6_* migrations (WS6: kennel profile bundles)
- src/lib/db.ts, src/app/layout.tsx (coordinating session)

Done when: report the classification first; then the mismatch query returns 0 rows (or only rows you can explain), the 4 issues are closed after a prod check, and the PR is merged or waiting on the owner.

[House rules]
```

---

## Workstream 4: Calendar-feed leaks — Audit fixes for Google Calendar and iCal sources

**Execution Type:** Quick Win Bundle
**Issues:** #2910, #2890, #2891, #2892, #2894, #2895, #2896, #2897; pending drafts for dlh3-gb, hoth3, lds-h3, berlinh3
**Scope:** `src/adapters/google-calendar/**`, `src/adapters/ical/**`, those kennels' rows in `prisma/seed-data/sources.ts`; migration `*_ws4_*`
**Rationale:** All from config-driven calendar sources, mostly fixable with existing config knobs. Includes a privacy leak (a personal appointment ingested as a run), which goes first.

```
You're taking on a Quick Win bundle in HashTracks: data leaks from Google Calendar and iCal feeds found by the recent kennel audits.

Context: these sources are config-driven (config in prisma/seed-data/sources.ts; adapters in src/adapters/google-calendar/ and src/adapters/ical/). Most fixes are existing config knobs (titleHarePattern, locationOmitIfMatches, staleTitleAliases, silentlySkipPatterns, kennelPatterns); see .claude/rules/adapter-patterns.md. Config changes reach prod only through a data migration.

Priority order:
1. Privacy: Devon Lunatics H3's Google Calendar (dlh3-gb) ingested a personal "In-person appointment" entry as a hash run. Hide it in prod (dry-run + the owner's OK) and filter it at the source. Its "vytbc" placeholder also leaks into titles.
2. Heart of Texas H3 (hoth3): 567 weekly Wednesday "HOTH3 Humpin Hash" runs are merged into the full-moon kennel, and 13 titles contain a literal <br>. Ask the owner whether Humpin should be its own kennel; re-attribute rather than delete (memory feedback_aggregator_misroute_reassign_not_insert).
3. Leaks on upcoming runs: #2910 Isca H3 hares stay in the title and map-link-only locations are dropped; LDS H3 shows location "See calendar details"; Berlin H3 descriptions end with "Location URL: None".
4. Cheltenham & Cotswold H3 (iCal): #2890 description boilerplate, #2891 every end time is start+2h, #2892 source link needs a login.
5. Chichester H3 (iCal): #2894 hares dropped with a theme word or "??", #2895 a hare named "Hash Flash", #2896 "Rin 1102", #2897 archive venues/notes in hares.
Items 1–3 (except #2910) are pending audit findings, not issues yet. The promoter files findings as GitHub issues daily around 14:00 UTC; close any that appear with your PR ("Closes #N").

Start by reading: gh issue view for 2910 2890 2891 2892 2894 2895 2896 2897; those kennels' source rows in prisma/seed-data/sources.ts; src/adapters/google-calendar/adapter.ts and src/adapters/ical/adapter.ts; read-only psql for the pending findings: SELECT "kennelCode", title, "bodyMarkdown" FROM "AuditFindingDraft" WHERE status='PENDING' AND "kennelCode" IN ('dlh3-gb','hoth3','lds-h3','berlinh3').

Goal: fix in config where a knob exists, in adapter code only where one is missing; one data migration named *_ws4_*; repair existing rows (dry-run + OK).

Scope boundary — other parallel sessions own these; do NOT modify them:
- src/adapters/html-scraper/{kaohsiung-hash,boiseh3,seoul-h3,gohash,barnes-hash,dhekelia-hash}.ts (WS1)
- src/lib/geo.ts and admin geocode actions (WS2)
- src/pipeline/merge.ts (WS3). If a fix needs merge.ts, report it instead.
- src/app/api/audit/**, src/lib/admin/**, src/pipeline/audit-draft-promoter.ts (WS5)
- prisma/seed-data/kennels.ts profile fields and *_ws6_* migrations (WS6: kennel profile bundles)
- src/lib/db.ts, src/app/layout.tsx (coordinating session)
In sources.ts edit only your kennels' rows. The MH3 Minneapolis title issue (#2850) belongs to WS3; if WS3 finds its cause in the GCal adapter, the coordinating session may route it to you.

Done when: priorities 1–3 are fixed and verified in prod; 4–5 are fixed or explicitly deferred in your report; issues are closed after a prod scrape check.

[House rules]
```

---

## Workstream 5: Audit fix-rate — Pipeline and automation

**Execution Type:** Quick Win Bundle
**Issues:** labels for #2795, #2798, #2911, #2591, #2315, #2400, #1526, #1353, #2916; stale drafts
**Scope:** `src/app/api/audit/**`, `src/lib/admin/**`, `src/pipeline/audit-draft-promoter.ts`, `src/app/admin/audit/**`, `docs/kennel-onboarding/implement-handoff-prompt.md`, new `docs/ops/audit-fixer-task.md`
**Rationale:** The audits stay at full rate (the owner values the findings). The gap is fixing: deep dives find ~15 a day, the promoter files 12, and fixes happen only in sessions like this one. File findings while they're fresh, drop the ones that are already fixed, send source gaps to the onboarding automation, and add a daily scheduled fixer modelled on the onboarding implementer.

```
You're taking on a Quick Win bundle in HashTracks: raise the rate at which audit findings get fixed, without slowing the audits.

Context: a scheduled task deep-dives about 5 kennels a day through the token-authenticated agent API (src/app/api/audit/agent/*), and a daily hareline audit adds more. Findings land as AuditFindingDraft rows; the promote-audit-findings cron files at most 12 a day as GitHub issues (MAX_PROMOTIONS_PER_RUN in src/pipeline/audit-draft-promoter.ts). Inflow is ~15 a day, so 52 drafts are waiting (oldest 2026-11-09) and 66 audit issues are open (about 19 a week ago). Waiting drafts go stale: two say Hellgate H3's history backfill is missing, but it was applied on 2026-11-12. The owner wants the audits to keep running at full rate; do NOT add any throttle or pause.

Goal:
1. File findings while they're fresh: raise MAX_PROMOTIONS_PER_RUN so the daily run clears a normal day's inflow plus backlog (e.g. 30), keeping GitHub write limits and the existing dedupe/PII guards intact.
2. A way to discard a stale draft before it's filed (an admin action on /admin/audit, and an agent endpoint if cheap), recording a reason. Then discard the two Hellgate drafts and any others you can prove stale against prod (list them and wait for the owner's OK). Other sessions are fixing the Dhekelia, Devon Lunatics, Heart of Texas, LDS, Berlin and profile-bundle findings right now; leave those drafts unless the coordinating session tells you they're done.
3. Route source gaps to the onboarding automation: coverage-gap and history-backfill findings get the onboarding-candidate label (the nightly research task reads it). Set it in src/lib/admin/deep-dive-prompt.ts or the promoter's label derivation, and add the label to existing issues #2795, #2798, #2911, #2591, #2315, #2400, #1526, #1353, #2916.
4. Open a one-line PR changing "Adapter tier: OFF." to "Adapter tier: ON." in docs/kennel-onboarding/implement-handoff-prompt.md, and leave it for the owner to merge.
5. Write docs/ops/audit-fixer-task.md: the prompt for a daily scheduled "audit fixer" task, modelled on docs/kennel-onboarding/implement-handoff-prompt.md. Each run takes the oldest open audit issue that is config-only or a single-adapter fix with a reproducible sample, skips issues referenced by an open PR or labelled in-progress, labels it in-progress, fixes it in a fresh clone, runs the checks and /code-review, opens a PR, and leaves merging to the owner's owner-approved label (migrations included). It must never write to prod. The owner creates the scheduled task (auto mode refuses to), so give exact setup steps; recommend starting it after this wave's PRs land so it doesn't race the parallel sessions.

Start by reading: src/pipeline/audit-draft-promoter.ts, src/app/api/cron/promote-audit-findings/route.ts, src/app/api/audit/agent/*, src/lib/admin/deep-dive-prompt.ts, src/app/admin/audit/actions.ts, docs/kennel-onboarding/implement-handoff-prompt.md, scripts/onboarding-merge-handoff-pr.sh, docs/self-healing-v2-plan.md (the audit fixer is part of that plan's direction).

Scope boundary — other parallel sessions own these; do NOT modify them:
- src/adapters/** (WS1 and WS4)
- src/lib/geo.ts and admin geocode actions (WS2)
- src/pipeline/merge.ts (WS3)
- prisma/seed-data/kennels.ts and kennel profile migrations (WS6)
- src/lib/db.ts, src/app/layout.tsx (coordinating session)

Done when: the higher cap and the discard tool are merged (or waiting on the owner if they need a migration), stale drafts are discarded after the owner's OK, labels are applied, the adapter-tier PR is open, and docs/ops/audit-fixer-task.md is merged with setup steps for the owner.

[House rules]
```

---

## Workstream 6: Kennel profile bundles — Profile data

**Execution Type:** Quick Win Bundle
**Issues:** #2794, #2797, #2800, #2818, #2822, #2823, #2847, #2862, #2865, #2893, #2898, #2915, #2516; queued findings for ah3-gu, da2b, devonport-h3, dh3-oh, dlh3-gb, gh3-gd, h5-gb, hannover-h3, hellgate-h3, hoth3
**Scope:** profile fields of those kennels' rows in `prisma/seed-data/kennels.ts`; one data migration `*_ws6_*`; self-hosted logos under `public/kennel-logos/`
**Rationale:** The biggest single block of audit issues, all the same kind of change. Profile values must be verified and reach prod through a migration (seed only fills NULLs).

```
You're taking on a Quick Win bundle in HashTracks: kennel profile bundles found by the audits.

Context: the kennel audits filed "Profile bundle" issues listing missing or wrong profile fields (founder, founded year, parent hash, Facebook/Instagram, website, logo, contact email, hash cash, schedule, description). Issues: #2794 Abuja H3, #2797 Barbados Bike H3, #2800 Basel-Stadt H3, #2818 Big Lik H3, #2822 BoiseH3, #2823 Bucharest Full Moon H3, #2847 Bucharest H3, #2862 Cambridge H3, #2865 Cebu H3, #2893 Cheltenham & Cotswold H3, #2898 Chichester H3, #2915 City of Exeter H3, #2516 Southern Comfort H3. Ten more are queued as audit findings and will be filed as issues around 14:00 UTC: ah3-gu, da2b, devonport-h3, dh3-oh, dlh3-gb, gh3-gd, h5-gb, hannover-h3, hellgate-h3, hoth3 (read them: SELECT "kennelCode", title, "bodyMarkdown" FROM "AuditFindingDraft" WHERE status='PENDING' AND "ruleSlug" ILIKE '%profile%').

Rules for values:
- Fill only columns that exist on the Kennel model (description, website, schedule*, facebookUrl, instagramHandle, twitterHandle, discordUrl, mailingListUrl, whatsappUrl, contactEmail, contactName, gm, hareRaiser, signatureEvent, founder, parentKennelCode, hashCash, paymentLink, foundedYear, logoUrl). List any requested field with no column (first-run date, officers, etc.) in your report instead of adding schema.
- Each value needs a source you checked live (the kennel's own site, Facebook page, Harrier Central, or the audit's quoted evidence re-verified). Leave out anything unconfirmed; earlier work left out Abuja's founded year and Big Lik's currency for that reason.
- No personal data: only kennel or role contact addresses and group links the kennel publishes itself, never a personal email or phone number.
- Self-host logos whose URLs are tokenized or unstable (memory feedback_self_host_unstable_logos).
- Seed only fills NULLs, so changed values reach prod only through a data migration (memories feedback_kennel_profile_fills_need_migration_not_seed, reference_kennel_seed_null_fill_skips_changes). Model the migration on prisma/migrations/20261106050000_profile_fixes_tdh3_pranburi_sffmh3_wrongway/. Dry-run it against prod inside BEGIN … ROLLBACK and show the per-kennel row counts and the before/after values.

Start by reading: each issue (gh issue view), the queued findings above, those kennels' rows in prisma/seed-data/kennels.ts, and the example migration.

Goal: one PR with the kennels.ts edits and one data migration covering every verified value; close each issue once the migration is applied and the profile page shows the values; for queued findings that get filed as issues meanwhile, close them the same way.

Scope boundary — other parallel sessions own these; do NOT modify them:
- src/adapters/** and source rows in prisma/seed-data/sources.ts (WS1, WS4)
- src/lib/geo.ts (WS2), src/pipeline/merge.ts (WS3)
- src/app/api/audit/**, src/lib/admin/**, src/pipeline/audit-draft-promoter.ts (WS5)
- src/lib/db.ts, src/app/layout.tsx (coordinating session)
In kennels.ts edit only the profile fields of these kennels (the nightly onboarding implementer adds new kennels to this file).

Done when: the migration PR is merged after the owner's OK, prod shows the values, and the issues are closed or carry a comment listing what couldn't be verified.

[House rules]
```

---

## This session (coordinator)

- Ship the DB connection-pool fix: cache the Prisma client on `globalThis` in production too, and release idle connections on Fluid Compute (`attachDatabasePool` from `@vercel/functions`, which isn't installed yet). Self-host the three Google fonts (`next/font/local`) to end the preview-build flake. Scope: `src/lib/db.ts`, `src/app/layout.tsx`, font files.
- Route findings between sessions (e.g. WS3's GCal cause → WS4), relay nothing as approval, and verify each session's result in prod before reporting it done.
- Owner items: Grand Strand Facebook decision, the 3 old workflows, the ops-digest task, `owner-approved` on #2810, the Vercel connector, merging the adapter-tier PR.

## Parallelization notes

- `src/pipeline/merge.ts`: WS3 owns the title logic; WS2 touches only the geocode call site, if at all, and rebases if WS3 merges first.
- `prisma/seed-data/sources.ts`: WS1, WS4 and the nightly implementer (Zagreb #2904 is open) edit different rows. `prisma/seed-data/kennels.ts`: WS6 edits profile fields; WS4 may add a kennel row if the owner splits Heart of Texas's Humpin runs out; the implementer adds new kennels. Migrations are named per workstream; whoever merges second rebases.
- WS3 → WS4 hand-off: if the MH3 Minneapolis cause is in the GCal adapter, WS3 reports it and this session routes it to WS4.
- Audits keep running at full rate. Queued findings that WS1/WS4/WS6 fix may be filed before the fix lands; those sessions close the filed issues in their PRs, and WS5's discard tool drops the rest. WS5's higher promotion cap will file the 52-draft backlog within about two days, so expect the open audit-issue count to rise before it falls.
- Approvals: six sessions, each sending one batched approval request. WS1/WS4/WS5/WS6 land first; WS2/WS3 report root cause before proposing any repair.
- The audit-fixer scheduled task (WS5 item 5) starts after this wave lands, so it doesn't race these sessions for the same issues.
- Expected result if all six finish: about 29 audit issues closed, ~20 queued findings fixed before or soon after filing, and a daily fixer to keep pace with ~15 new findings a day.
