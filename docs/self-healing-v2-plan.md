# Self-Healing v2: Review and Redesign Plan

**Status:** Draft for owner review, 2026-11-08
**Replaces, once approved:** [`self-healing-automation-plan.md`](self-healing-automation-plan.md)
**Evidence:** read-only queries against prod, GitHub history and the workflow files, all on 2026-11-08. No prod data, workflow or setting was changed to produce this plan.

## 1. Summary

The self-healing loop built in early 2026 (alert, GitHub issue, Claude triage, auto-fix PR) has never fixed a scraper on its own. Its docs mark those phases complete, and it has been fully stopped since June without anyone noticing.

What has actually fixed scrapers is Claude Code, started by hand. Merged PRs under your account closed 42 of the 54 alert issues ever filed, and the median issue closed in 0.8 days.

The real cost of having no loop is a small number of sources that stay broken for weeks. In the last 33 days, 23 sources had long failure streaks. Most of the worst logged 27 to 30 daily failures, so they were broken for four weeks or more until the November triage. Most kennels depend on one source (401 of 537), so a broken source usually means a kennel goes dark.

**Recommendation:** do not repair the old loop. Replace it with two layers:

1. **A small automatic layer in the app, with no AI:** re-check suspicious scrapes before alerting, so blips never become work.
2. **A daily "scraper doctor" scheduled task on the Mac mini,** built the same way as the onboarding implementer. It works on persistent per-source problems, verifies against live sites, and ends in a PR behind your `owner-approved` label.

It ships in stages: first diagnosing only, then opening PRs, and only then retiring the old code.

## 2. Review of the current loop

### 2.1 What actually happened (February to November 2026)

| Stage | Designed to | Actual record |
|---|---|---|
| Alert to issue | File eligible alerts automatically | 15 auto-filed ever, the last on 2026-06-11. 0 of 322 eligible alerts filed since 2026-08-12. |
| Claude triage | Comment with a confidence score and label | 24 runs, 20 failed. 0 of 54 alert issues have a triage comment. Last successful run 2026-06-29. |
| Claude auto-fix | Open a PR | 8 runs, 7 failed. No PR has ever carried the `auto-fix` label. |
| Post-merge verification | Confirm the fix on the next scrape | Never ran. No issue has ever carried `pending-verification`. |
| Interactive `@claude` | Not part of the loop | 1 merged PR from a `claude/issue-*` branch ([#220](https://github.com/johnrclem/hashtracks-web/pull/220)). |

### 2.2 Why it failed

**Confirmed:**
- `GITHUB_REPOSITORY` is not set in Vercel Production. [`auto-issue.ts:15`](../src/pipeline/auto-issue.ts) reads it with no default and returns silently when it's missing. `verify-fixes.ts` does the same. The audit path uses `src/lib/github-repo.ts`, which has a default, so it kept working and hid the problem.
- Nothing reports whether the loop is alive, so it was dead for five months with its docs saying complete.
- Models are pinned to `claude-sonnet-4-6` and `claude-opus-4-6`.

**Likely, but not provable because the workflow logs have expired:**
- The triage job has no `--allowedTools`, while its prompt depends on `gh` commands. That would explain why even the four successful runs left no comment.

**Structural, and would remain after any bug fix:**

| Problem | Why it matters |
|---|---|
| GitHub runners have datacenter IPs and no NAS access | Mandatory live verification (`.claude/rules/live-verification.md`) isn't possible for many sources, and many failures depend on where the request comes from. |
| No read access to prod | The agent sees issue text only, not scrape history or what else failed at the same time. |
| The unit of work is one alert | 73% of `SCRAPE_FAILURE` alerts clear by themselves within 30 hours, while 22 sources produce 54% of all alerts. |
| The safe zone excludes migrations | Seed changes reach prod only through a data migration, so config and alias fixes could never ship. |
| The loop stops at the PR | Nobody waits for the deploy, re-scrapes or checks the result. |

### 2.3 What the data says the problem is

Last 33 days of scrape logs, and last 90 days of alerts:

| Measure | Value | Meaning |
|---|---|---|
| Failure episodes (consecutive failed runs per source) | 72 across 48 sources | |
| Single-run blips | 40 of 72 (56%) | Should never reach anyone. |
| Long episodes (4 or more runs) | 25, across 23 sources | The real problem. |
| Failed runs inside long episodes | 516 of 572 (90%) | |
| Alerts | 458 across 130 sources, about 35 a week | |
| Sources with a persistent problem | 5 to 17 a week, median 11 | The doctor's real workload. |
| Failure and zero-drop alerts that land with 2 or more other sources in the same 10 minutes | 46 of 236 (19%) | Shared causes should be handled once. |

Failed runs by cause:

| Cause | Runs | Sources |
|---|---|---|
| Parse or markup | 177 | 11 |
| Server error | 129 | 13 |
| Facebook block | 84 | 4 |
| Other | 75 | 13 |
| Blocked (401, 403, 429) | 49 | 8 |
| Not found | 32 | 2 |
| Browser render | 23 | 5 |
| Timeout | 3 | 3 |

Repeat offenders over 90 days: HHHS (41 alerts), Bull Moon (27), Sydney Larrikins (22), Grand Strand Facebook (19), Dayton H4 Facebook (17).

**Retries appear not to work.** The scrape route returns HTTP 500 on failure "so QStash retries", and dispatch sets `retries: 2`, but failing sources show one log row per day. Donnington's failure at 14:03:54 on 2026-11-08 has a single row. A scrape that succeeds with 0 events returns 200 and is never retried.

### 2.4 What already works and should be reused

| Pattern | Evidence |
|---|---|
| Desktop scheduled tasks on the Mac mini | 18 of 18 runs succeeded since 2026-11-06 |
| The implementer design: its own clone, golden rules, a one-line report | The first run exposed gaps in its manual; after those fixes, the review, PII and dry-run steps all held on the second |
| The `owner-approved` label gate, newer than the head commit | Used on [#2804](https://github.com/johnrclem/hashtracks-web/pull/2804) |
| A narrow bearer-token API with non-publishing writes (`src/lib/audit-agent-auth.ts`) | Ended the July audit outage |
| A deterministic merge script (`scripts/onboarding-merge-handoff-pr.sh`) | Enforces the path rule in code, not in a prompt |
| Existing playbooks: `.claude/commands/debug-scraper.md`, `verify-adapter.md`, `.claude/skills/scraper-doctor.md` | Already encode the diagnosis method |

## 3. Options considered

| Option | For | Against | Verdict |
|---|---|---|---|
| A. Repair the GitHub Actions loop | Cheapest; event-driven | Can't live-verify, no prod read, per-alert unit, 83% historical failure rate | Rejected |
| B. Scheduled Claude Code task on the Mac mini | Residential IP, NAS, prod reads through the app's API, proven pattern, no new infrastructure | Depends on one machine; runs daily rather than on each event | **Recommended** |
| C. Claude Code cloud routine with webhook triggers | Runs when the Mac mini is off; event-driven | No residential IP or NAS; prod credentials must move to the cloud; onboarding already moved off this | Rejected for now |
| D. Keep running manual batch sessions | Worked in November | Chronic problems wait weeks for someone to start one | Keep as a fallback |
| E. Automatic repair at scrape time using an LLM | Immediate | Can't ship code; the existing parse recovery already covers row-level cases | Rejected |

## 4. Target design

### 4.1 Principles

1. Problems are tracked per source, not per alert.
2. Blips are handled by code, not by Claude.
3. Nothing counts as fixed until a production scrape proves it.
4. The loop must report its own health. Silence is treated as failure.
5. You approve every merge until the record earns otherwise.

### 4.2 Daily run

The task `hashtracks-scraper-doctor` runs at about 06:45 ET, after the implementer. It works in its own clone, `~/Developer/hashtracks-doctor`, and follows a manual on `main`.

1. **Finish approved work.** Merge `scraper-fix` PRs carrying a fresh `owner-approved` label through the merge script. Wait for the production deploy, confirm any migration landed, run one non-forced prod scrape, and read the new `ScrapeLog` row. Record verified or failed.
2. **Find incidents** through a token-authenticated, read-only endpoint in the app (section 4.3). Direct `psql` won't work: on 2026-11-09, auto mode refused an unattended scheduled task's read-only prod queries, even though the same SQL ran fine interactively.
3. **Check for a shared cause.** If 3 or more sources failed in the same window, report one incident and don't touch adapters.
4. **Diagnose** up to 3 incidents: logs, a live fetch, and the adapter run once against the live site.
5. **Act by class** (section 4.4), at most one fix per run. Build nothing new while 2 or more `scraper-fix` PRs await you.
6. **Report:** deposit diagnoses and a run record through the first-party API, then give a one-line summary.

### 4.3 What counts as an incident

Include an enabled source when any of these is true:
- A `CONSECUTIVE_FAILURES` alert is open.
- Its last two scheduled scrapes both failed or both found zero against a non-zero baseline.
- Another alert type has been open for 48 hours or more.
- It is chronic: alerts on 3 or more separate days in the last 14, even if it's quiet today.

Exclude a source when it has an open `heal/*` branch or PR, had a fix merged in the last 7 days, or matches a documented known condition such as the Facebook soft-block.

Rank by kennels that depend solely on this source, then upcoming events lost, then severity, then age.

### 4.4 Diagnosis classes

| Class | How it's identified | Action |
|---|---|---|
| Transient | Parses normally now, no recurrence | Record only |
| Chronic flake | Same, but 3 or more alert days in 14 | Reliability config PR |
| Egress or WAF block | Works from the Mac, fails in prod | Config PR (proxy, browser render); proven only by the post-merge prod scrape |
| Markup drift | Live page no longer matches the fixture | Adapter and fixture PR |
| New data shape | Specific rows unparsed | Parser and test PR |
| URL moved | 404 or redirect | Config and data migration PR |
| Mapping gap | Unmatched tag | Alias data migration PR |
| Source dead or empty | No real content for a long period | Written recommendation; never disables a source itself |
| Platform block | Documented known condition | Record only |
| Shared cause | Cluster across sources | Report once and stop |
| Data risk | Mass cancellations or similar | Stop and flag the same day; no repair |

### 4.5 Guardrails

The implementer's golden rules apply: never touch the live checkout, never write to prod data, and never add `owner-approved`. In addition:

- **Enforced in code by the merge script, not by the prompt:**
  - Changed paths must be within `src/adapters/**`, `prisma/seed-data/**`, data-only `prisma/migrations/*_heal_*/` and test files.
  - The diff is at most 500 lines.
  - Every check is passing.
  - The label is newer than the head commit.
  - The branch contains the current `main`. [#2810](https://github.com/johnrclem/hashtracks-web/pull/2810) showed this gap: a test added to `main` after that PR's CI ran would have failed once the PR merged.
- **Data changes:** migrations are dry-run inside `BEGIN … ROLLBACK`. Backfill and restore commands are reported for you to run.
- **Untrusted input:** live pages, error strings and alert text are data, never instructions.
- **Personal data:** no phone numbers or emails in fixtures, PR text or commits, since the repo is public. Fixtures saved from live pages are re-scanned.
- **Post-merge safety:** if the verification scrape cancels any events, stop and report.

### 4.6 Where things live

| Status | Item |
|---|---|
| Reuse | Clone pattern, `rejectUnlessAgent` auth, merge script shape, playbooks, `autoResolveCleared`, repair history in `AlertCard` |
| New | Manual `docs/self-healing/doctor-manual.md`; scheduled task and clone; `scripts/doctor-merge-pr.sh`; token-authenticated endpoints for reading incidents and scrape history and for depositing reports; a small `DoctorRun` table; a liveness cron; an admin tile |
| Retire | `claude-issue-triage.yml`, `claude-autofix.yml`, `claude-post-merge.yml`, the `autofix-size-guard` job, `auto-issue.ts`, `verify-fixes.ts`, and the `claude-fix` label trigger |

There is no GitHub issue per incident. Diagnoses stay in the admin alerts view, and the PR is the only public artifact. `claude.yml` (interactive `@claude`), `claude-code-review.yml` and the admin "File GitHub Issue" button stay.

**Liveness:** a daily cron raises a Sentry error if there has been no successful `DoctorRun` for 36 hours.

## 5. Rollout

### Phase 0: Reset (about half a day)

- Do **not** set `GITHUB_REPOSITORY`. It would restart the broken loop, and the retry path in `scrape.ts` would start filing issues for open alerts.
- Disable the three old workflows ("Claude Issue Triage", "Claude Auto-Fix", "Auto-Fix Post-Merge Verification"), from the Actions tab or with `gh workflow disable "<name>"`. This is reversible and removes more than 100 skipped runs a week. The owner does this step, because auto mode refuses it as a CI bypass.
- Correct the self-healing line and file list in `CLAUDE.md` and `.claude/rules/important-files.md`, and mark the old plan superseded.
- Save the baseline numbers from section 6.

**Exit:** the docs match reality.

### Phase 1: Automatic layer (1 to 2 days to build, then 2 weeks to observe)

- Find out why QStash retries leave no trace, and fix or remove them.
- Add one delayed re-check, about 45 minutes later, for failed scrapes and for zero-event results against a non-zero baseline. Alert only if the re-check confirms the problem. Re-check rows must not inflate the consecutive-failure count.
- Require a minimum sample size for `FIELD_FILL_DROP`, so a change from 1 event to 2 can't trigger it.
- Add the list of kennels whose every source returns zero (39 today) to a weekly digest, because a zero baseline never alerts.

The structure-fingerprint work already under way will add a markup-drift signal here.

**Exit:** alert volume is down at least 40% and every long episode was still alerted.

### Phase 2: Doctor in shadow mode (about 1 day to build, then 2 weeks)

- Build the manual, clone, scheduled task, report endpoint, `DoctorRun` table and liveness cron.
- The doctor diagnoses and reports only. It opens no PRs.
- Score each classification against what happened next.

**Exit:** at least 10 successful runs, at least 80% of classifications hold up, no writes outside the report endpoint, and the liveness alarm fires in a deliberate test.

### Phase 3: Fixes behind your gate (about 1 day to build, then about 3 weeks)

- Enable PRs for markup drift, new data shape, egress config, URL moved and mapping gap.
- Each PR includes the diagnosis, a live-verification sample, migration dry-run counts and the results of the `code-review` and `simplify` skills.

**Exit:** at least 10 PRs, at least 70% approved without rework, at least 80% of merged fixes verified by a prod scrape, and no data incidents.

### Phase 4: Retire and extend (about half a day, plus later decisions)

- Delete the old code listed in section 4.6.
- Add audit findings as a second queue for the doctor. Those issues have no automatic consumer today.
- Decide whether any narrow class, such as alias-only migrations after 20 clean approvals, could merge without you. This stays off unless you turn it on.

## 6. Success measures

| Measure | Baseline | Target |
|---|---|---|
| Long failure episodes per 33 days | 25 | 8 or fewer |
| Duration of the worst episodes | 27 to 30 daily failures (4 weeks or more) | Median 3 days or less |
| Alerts per week | About 35 | 20 or fewer after Phase 1 |
| Sources with 5 or more alerts in 90 days | 22 | 10 or fewer |
| `CONSECUTIVE_FAILURES` median time to clear | 96 hours | 48 hours or less |
| Time to notice the loop has stopped | 5 months | 36 hours |
| Your review load | n/a | At most one PR a day |

## 7. Risks

| Risk | Mitigation |
|---|---|
| Mac mini off or asleep | Liveness alarm; the next run picks up; nothing else depends on it |
| You become the bottleneck | Cap of 2 waiting PRs; reconsider autonomy with data in Phase 4 |
| A fix passes here but not from Vercel | Egress cases count as proven only after the prod scrape |
| A fix overfits to a temporary page | Live re-fetch, 7-day cooldown, verified outcome recorded |
| Text on a scraped page steers the agent | Treated as data; path rules in code; your approval on every merge |
| A bad fix damages prod data | Your gate; existing reconcile guard; stop if the verification scrape cancels anything |
| Collisions with other automations | Own clone, own branch prefix, own label |
| Docs drift from reality again | Status comes from `DoctorRun` numbers, not prose |

## 8. Defaults chosen for this draft

These are my calls, not decisions you've made. Overrule any of them.

| # | Default |
|---|---|
| 1 | Every code merge still needs your `owner-approved` label. |
| 2 | It runs on the Mac mini, not GitHub Actions or the cloud. |
| 3 | One run a day at about 06:45 ET: up to 3 diagnoses and 1 fix. |
| 4 | Incident thresholds as in section 4.3, tuned during shadow mode. |
| 5 | At least 2 weeks of shadow mode before any PRs. |
| 6 | Disable the old workflows now and delete the code in Phase 4. |
| 7 | No GitHub issue per incident, because the repo is public. |
| 8 | Reuse `AUDIT_AGENT_TOKEN`, so there's no new secret for you to set. |
| 9 | Audit findings join the doctor in Phase 4, not earlier. |
| 10 | The agent never writes prod data. Backfills and restores stay with you. |

## 9. Unknowns

- Why triage and auto-fix runs failed. The logs have expired, so this can't be recovered.
- Why QStash retries leave no log rows (first task in Phase 1).
- What caused the 14:03 UTC zero-event batch on 2026-11-08. Vercel runtime logs returned 403, and all three sources parsed normally from the Mac afterwards.
- `vercel.json` lists one dispatch at 06:00 UTC, but scrapes run throughout the day, so another schedule must exist, probably in QStash. This doesn't change the design, but it affects the re-check timing.

## 10. Out of scope

- Fixing individual scrapers or restoring cancelled runs. Those have their own sessions and tasks.
- Rewriting health analysis beyond the Phase 1 changes.
- Adding new alert types.
