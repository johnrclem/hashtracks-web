# HashTracks ops system

How HashTracks keeps about 460 changing sources accurate and keeps adding kennels: the work
queue, the automations, the gates on prod writes, and what to do when one breaks. Every task
manual links here.

It describes the system as the ops plan (amended 2026-11-17) sets it out. Parts still being built
are marked with the plan session that lands them and **building**: lanes (S1), the watchdog (S2),
bot identities and the write gate (S4), and the auto-approve tier for insert-only onboarding
migrations (S5). Each marker goes when its part is live.

## The three loops

| Loop | Detects | Repairs | Where the work waits |
|---|---|---|---|
| **Scraper health** | Each scrape writes a `ScrapeLog`; `src/pipeline/health.ts` raises `Alert` rows | A supervised session, from `/admin/alerts` | `lane:incident` issues, filed with the "File GitHub Issue" button on `/admin/alerts` |
| **Data quality** | The daily audit cron, the kennel deep dive and the hareline audit submit findings | The audit fixer task, through `audit-fix` PRs | `lane:defect` issues |
| **Coverage** | The daily onboarding task researches one kennel and writes a handoff | The implementer task builds handoffs into `onboarding-impl` PRs; history backfills are applied by the owner | `lane:coverage` issues, `docs/kennel-onboarding/`, `onboarding-impl` PRs |

Lane labels arrive with S1 (below); until then the work waits under `audit`, `alert` and
`onboarding-candidate`. Detection doesn't wait on repair. If a lane's open count grows two weeks
running, add repair capacity; don't throttle the audits.

## Lanes

Every unit of work is a GitHub issue with exactly one lane label. Admin pages only display issues;
they hold no work of their own. Every issue the server files now carries its lane. **Building
(S1):** the one-shot relabel of the open issues (`scripts/relabel-open-issues-lanes.ts`), which
waits on the owner's approval. Until it runs, older issues carry no lane label, and the tasks fall
back to the labels used today (below).

| Label | Meaning | Filed by | Worked by |
|---|---|---|---|
| `lane:incident` | A source keeps failing, a feed has gone silent, or several sources fail together | the Alerts page button; later `incident-sync` | a supervised session; later the scraper doctor |
| `lane:defect` | Wrong or missing data that a config or adapter fix can repair | the promoter, the audit cron, rule drift | the audit fixer |
| `lane:coverage` | A kennel, source or history not loaded yet (replaces `onboarding-candidate`, which stays as an alias for a month) | the promoter, the research task | the research task and the implementer |
| `lane:decision` | Blocked until the owner chooses; the issue states the question in one line | any agent | the owner, through the digest |
| `lane:ops` | An automation or pipeline stopped | the watchdog | a supervised session |

- `audit`, `audit:*` and `kennel:*` stay as origin labels. `alert` is retired from audit issues.
- **How a finding gets its lane** (`laneForRule` in `src/lib/audit-labels.ts`, used by the
  promoter, the audit cron and `/api/audit/file-finding`): a source-gap rule (`source-coverage-gap`,
  `historical-events-gap` and their synonyms) → `lane:coverage`, which also gets
  `onboarding-candidate` (planned removal about 2026-12-18, once the research task reads
  `lane:coverage`; until then every coverage filing carries it); `schema-gap` → `lane:decision`; anything else →
  `lane:defect`. Escalation meta-issues (`audit:needs-decision`) → `lane:decision`. Rule drift →
  `lane:defect`. In-app user feedback → `lane:decision`.
- **Agents request `lane:decision`, and nothing else,** with `"labels": ["lane:decision"]` on a
  finding, putting the question on the body's first line. The submit endpoint rejects any other
  label (400).
- **Incident issues carry `kennel:*` labels** for each kennel the alerting source feeds, so the
  fixer's incident skip finds them.
- The fixer takes only `lane:defect`, and skips kennels that have an open `lane:incident`.
- The mirror syncs issues labelled `audit` or any `lane:*`, and records the lane in
  `AuditIssue.lane`. A lane-only issue mirrors as stream `UNKNOWN` with `hasAuditLabel = false`,
  and the per-stream stats on `/admin/audit` count only `audit` issues.
- The label sync (part of `/api/cron/sync-audit-issues`) keeps each lane label's color and
  description.
- **The server scrubs secrets before posting.** Every issue body and comment the server files
  passes through `scrubSecrets` (`src/lib/audit-redact.ts`): `key=`/`token=`/`sig=` query values,
  `AIza…` keys, bearer tokens, URL credentials and the like. It removes those recognized
  patterns, not every possible credential, so never paste a raw secret. `scripts/scrub.ts` uses
  the same patterns.
- **Until the relabel:** the fixer works `audit` issues and switches to `lane:defect` by itself once
  any issue carries it; the digest reads `audit:needs-decision` as well as `lane:decision`.

## How a finding becomes an issue

1. A finding is submitted as an `AuditFindingDraft` row (`PENDING`) through the agent API
   (`/api/audit/agent/*`) or by the audit cron.
2. The promoter (`src/pipeline/audit-draft-promoter.ts`) files it as a GitHub issue, deduped
   against open issues. It runs hourly via QStash, with the daily 14:00 UTC Vercel cron as a
   backstop, under a transaction-scoped advisory lock so two runs never file the same draft. If
   GitHub can't answer the dedup check, the draft stays `PENDING` and is retried next hour.
3. The mirror cron (`/api/cron/sync-audit-issues`, 12:30 UTC) copies `audit` and `lane:*` issues
   into `AuditIssue` for `/admin/audit`.
4. An issue closes only after a prod scrape or a page check confirms the fix.

A `PENDING` draft older than 2 hours means filing is stuck: the daily digest flags it.

## Automations

**Vercel crons** (`vercel.json`, UTC): scrape dispatch 06:00 (fans out per-source scrapes
through QStash), audit 12:00, audit-issue mirror 12:30, finding promoter 14:00 (backstop),
travel-draft GC 03:00, scrape-log GC 03:30, Strava cache purge 03:45, prediction ledger Monday
08:00, rule drift Monday 09:00.

**QStash schedules** (`scripts/setup-qstash-schedule.ts`, run once by the owner after a change):
the hourly finding promoter.

**Scheduled tasks on the Mac mini** (Claude Code desktop app, local time):

| Task | When | Manual | Output |
|---|---|---|---|
| `hashtracks-kennel-deep-dive` | 5 times a day | its prompt, plus the agent API's | findings via `/api/audit/agent/*` |
| `hashtracks-hareline-audit` | daily 08:30 | its prompt, plus the agent API's | findings via `/api/audit/agent/*` |
| `hashtracks-ops-digest` | daily 07:15 | [`daily-digest-task.md`](daily-digest-task.md) | `~/Developer/hashtracks-ops-digests/<date>.md`, phone push when something needs the owner |
| `hashtracks-audit-fixer` | daily 10:30 | [`audit-fixer-task.md`](audit-fixer-task.md) | `audit-fix` PRs |
| `hashtracks-kennel-onboarding` | daily 03:00 | [`daily-onboarding-prompt.md`](../kennel-onboarding/daily-onboarding-prompt.md) | handoff PRs (docs only) |
| `hashtracks-kennel-implement` | daily 05:00 | [`implement-handoff-prompt.md`](../kennel-onboarding/implement-handoff-prompt.md) | `onboarding-impl` PRs and retros |

The audit fixer stays at one run a day until owner review latency (below) is under 24 hours.
Before then, more runs only lengthen the review queue.

**Task prompts.** Each task's prompt lives in this repo as
[`scheduled-tasks/<task>.txt`](scheduled-tasks/README.md); the task itself holds only a pointer of
four lines, from [`scheduled-tasks/pointers/`](scheduled-tasks/pointers/), that fetches the prompt
from `main` and follows it. A prompt change is therefore a reviewed PR, and the owner pastes
pointers only when a pointer itself changes. The digest compares each task's `SKILL.md` with its
pointer every morning and flags drift. Each task's branch prefix is in
[Branch prefixes](#branch-prefixes).

**Watchdog (building, S2).** An automation that runs but produces nothing is down. Until the
watchdog lands, the digest's look at the task runs is the only check. Then:

- Every cron route runs inside `withCronRun()` (`src/lib/cron-run.ts`), which writes an
  `AutomationRun` row and sends exceptions to Sentry. `/api/cron/scrape/[sourceId]` is left out;
  `ScrapeLog` covers it. Each authenticated agent API call is recorded the same way, by the server.
- `src/lib/automation-registry.ts` gives each automation a cadence, a grace period and the side
  effects it must leave: deep-dive AuditLog rows and submit or discard calls; a daily
  `hareline-prompt` call and a hareline draft at least every 7 days; a daily `ops-digest` call; a
  daily `audit-fix` PR, issue comment or close from the fixer; PRs or commits from the implementer
  and research; run rows from each cron; a `ScrapeLog` every hour. No `PENDING` draft may be older
  than 2 hours.
- **Blocked on the owner is not down.** When the fixer has 4 PRs waiting on the owner, or the
  implementer has 2, the automation shows as `BLOCKED_ON_OWNER` in the digest and raises no alarm.
- The watchdog (`/api/cron/watchdog`, hourly through QStash with a daily Vercel backstop) moves an
  automation to `OVERDUE` with a conditional update, so overlapping runs act once. On that change it
  opens one `lane:ops` issue and sends a Sentry error event that emails the owner; on recovery it
  comments, closes the issue and sends one recovery event. Every desktop task overdue at once is a
  single "Mac mini silent" alarm, and an unfinished `_prisma_migrations` row raises the same alarm.
  Email through Resend follows once its key is set.

## Identity

Two GitHub Apps replace the owner's personal token. Their permissions and setup are in
[`infra/github-apps/`](../../infra/github-apps/README.md).

- **HashTracks Server** is the server's identity on Vercel (`src/lib/github-app.ts`). Until its env
  is set the server falls back to `GITHUB_TOKEN`; the filing-health chip on `/admin/audit` shows
  which one is in use. Approval checks keep the read-only `GITHUB_APPROVAL_READ_TOKEN`.
- **HashTracks Agent** (`hashtracks-agent[bot]`) is the identity every scheduled task acts as. It
  has no Workflows, Administration or Actions permission, so the bot can't push a workflow change or
  change settings.

**The agent root.** Every task starts in `~/Developer/hashtracks-agents/`
([`infra/agent-root/`](../../infra/agent-root/README.md) has the details), which is not a git
repository, so no task's reset can reach it. Project settings load from the folder a session starts
in, so the root's `.claude/settings.local.json` holds for the whole run: `gh` has no stored login
and a shim first on `PATH` mints a fresh bot token for every call, or runs nothing if it can't.
Each task clone pushes through the same shim and commits as the bot. The root copies the repo's
deny list (the digest flags drift). Deliberate overrides remain possible and fall under T1.
Until the owner does the S4 steps, `gh` on the Mac is still the owner's login.

**Preflight.** Step 1 of every task runs this, before anything else (it's in the task's manual, or
in its prompt for the deep dive and the hareline audit, which have no manual of their own):

```bash
FLAG=$(curl -fsSL --max-time 20 https://raw.githubusercontent.com/johnrclem/hashtracks-web/main/docs/ops/system.md | grep -m1 '^Identity preflight:'); LOGIN=$(gh api user --jq .login 2>/dev/null); echo "preflight: login=${LOGIN:-unknown} | ${FLAG:-flag missing}"; case "$FLAG" in "Identity preflight: LOG"*|"Identity preflight: STOP unless $LOGIN") echo "preflight: OK" ;; *) echo "preflight: STOP" ;; esac
```

It prints the login the run acts as, which each task puts in its report. If it prints
`preflight: STOP`, the run stops before any other step. The digest is the one exception: it
writes nothing to GitHub, so it carries on and reports the failure first under "Needs you today". It reads this flag, on `main`:

Identity preflight: LOG

While the flag is `LOG`, the preflight only logs. The switch happens in this order:

1. The Apps exist, the root is installed, and every task is re-pointed to the root.
2. Each of the six tasks logs `login=hashtracks-agent[bot]` on a real scheduled run.
3. A docs PR changes the line to exactly `Identity preflight: STOP unless hashtracks-agent[bot]`,
   and switches the manuals' merge steps to `scripts/agent-merge-pr.sh`, which refuses to run as
   anyone but the bot.
4. The owner applies the ruleset on `main` ([Gates on prod writes](#gates-on-prod-writes)).

From then on a run whose `gh` isn't the bot stops before its first GitHub write: a missing settings
file, the wrong start folder or a broken shim each surface here. A missing or unreadable flag line
also stops the run.

**Resets keep the settings file.** Every reset line in a task prompt runs
`git clean -q -fdx -e node_modules -e .claude/settings.local.json`, so a reset never deletes
local settings, even if they were ever moved into a clone.

### Branch prefixes

Each task pushes branches under one prefix and no other; `-r2` rebuilds keep it. Match the whole
prefix, slash included: `onboard/` and `onboarding/` belong to different tasks. S4's gate treats a
branch under any of these as an agent's.

| Prefix | Task | Used for |
|---|---|---|
| `audit-fix/` | `hashtracks-audit-fixer` | `audit-fix/<kennelCode>-<YYYYMMDD>` fix PRs |
| `onboarding/` | `hashtracks-kennel-onboarding` | `onboarding/handoff-<date>-<code>` and `onboarding/noop-<date>` handoff PRs |
| `onboard/` | `hashtracks-kennel-implement` | `onboard/<code>-<YYYYMMDD>` build PRs and their retros |
| `deep-dive/` | `hashtracks-kennel-deep-dive` | reserved; the task never pushes |
| `hareline-audit/` | `hashtracks-hareline-audit` | reserved; the task never pushes |
| `ops-digest/` | `hashtracks-ops-digest` | reserved; the task never pushes |

Interactive and owner branches (`claude/…`, `fix/…`, `feat/…`) use none of these.

## Gates on prod writes

What holds today (the [write gate](#write-gate) below enforces the approval rule once its ruleset is on):

- **Agents never write to prod.** Prod changes through committed migrations, applied by
  `migrate deploy` on the production build, or through owner-run scripts.
- **The owner approves every agent PR that writes data:** the `owner-approved` label on an
  `audit-fix` or `onboarding-impl` PR. Agents never add that label, and a label older than the
  PR's latest commit doesn't count (a merge of `main` is the one exception).
- **Every prod write is dry-run first, with counts shown to the owner:** migrations with the
  dry-run tool below; backfills and cleanups with their own dry-run mode
  (`.claude/rules/prod-data-ops.md`).
- **Never run `prisma db seed` against prod.** Seed data reaches prod only through a migration.
- **History backfills** are applied by the owner (`BACKFILL_APPLY=1`). Automating them is
  designed in [`docs/onboarding-backfill-automation-design.md`](../onboarding-backfill-automation-design.md).
- **Agents scrub what they post.** Comments, issue bodies and PR bodies that a task posts with `gh`
  never pass through the server's filter, and local fetches run with the keys in the Mac's `.env`.
  Before posting, a task runs the text through `npx tsx scripts/scrub.ts`, which removes API keys,
  tokens, credentials in URLs, phone numbers and email addresses, and posts the result with
  `--body-file`. `--secrets-only` keeps contact details in committed data files such as handoffs.

### Write gate

GitHub enforces the gates, not the prompts. The gate runs now; the ruleset that makes it binding
goes on last, after the Apps exist and every task runs as the bot ([Identity](#identity)).

- **`write-gate.yml`** runs on `pull_request_target` (opened, synchronize, reopened, labeled,
  unlabeled), always from main's copy of the workflow and of `scripts/ci/write-gate*.ts`. It checks
  out `main` only and reads the PR's files through the API, as data; it never runs the PR's code.
  On each event it:
  1. **Stamps.** When `owner-approved` is added by the owner's account (`OWNER_GITHUB_LOGIN`,
     `johnrclem`, sender type `User`, in a run the owner triggered), it sets the commit status
     `backfill/approved` on the head GitHub reported with that event, described
     "Approved by the owner for PR #N". The label from anyone else, the agent App included, is
     ignored, and the gate comments that it ignored it. The stamp's format and the A2–A4 checks live
     in `src/lib/backfill/approval-stamp.ts`, which the gate and the backfill server share.
  2. **Classifies** the PR as `write:docs`, `write:code` or `write:migration` and labels it so.
     Migration paths come from `scripts/ci/migration-changes.ts`, the module CI's migration check
     uses. `write:insert-auto` waits for the S5 auto-tier checks.
  3. **Evaluates** and sets the `write-gate` status on the head. The PR passes in one of three ways:
     - **A valid approval:** `owner-approved` is on the PR now, the newest label event was the
       owner's, a stamp was made after it, and the head is the stamped head apart from merges of
       `main` (A2–A4). A push after the label fails it; removing the label revokes it.
     - **Owner-authored and low-risk:** the owner's own PR whose head the owner pushed, from a
       branch outside the [agent prefixes](#branch-prefixes), with no change under `prisma/migrations/` and none under
       `.github/workflows/` or `.github/actions/`. Interactive sessions run `gh` as the owner, so
       their PRs pass this way (T1). The digest lists every PR merged this way in the last 24 hours.
     - **Agent data-only:** the agent bot's PR (`hashtracks-agent[bot]`, or the repository
       variable `AGENT_BOT_LOGIN`) whose every path is in `docs/kennel-onboarding/handoffs/**` or is
       `run-log.md`, `target-queue.md` or `source-platform-notes.md` there. Never a `*-prompt.md`,
       `docs/ops/**`, `.claude/**` or `CLAUDE.md`. `scripts/onboarding-merge-handoff-pr.sh` allows
       the same list (`write-gate.test.ts` keeps them equal).
  4. **Fails** a workflow change without a valid approval, and any fork PR. A PR that is only
     waiting for the owner stays `pending`.

  A separate job, never queued, records who moved the head on every push (`write-gate/pusher`,
  "<login> (<type>)"), so a bot's push onto the owner's branch needs the label like any agent change.
  Opening a PR records its opener, who vouches for a head pushed before the PR existed; reopening
  records nothing, so a head pushed while the PR was closed doesn't get the owner path. The gate
  judges only PRs into `main`.
  Gate runs for one PR queue in order. If a label's run is dropped from the queue (two newer events
  arrived while one ran), its stamp is never written: re-add the label.
- **`scripts/agent-merge-pr.sh <pr>`** is how a task merges. It stops unless `gh` acts as the bot,
  waits for CI's `test` check and a `write-gate` success set by `github-actions[bot]` on the head,
  then runs `gh pr merge --squash --match-head-commit <head>`. Tasks switch to it in the same PR
  that switches the preflight to stop; until then their manuals merge as before.

#### The ruleset

One ruleset on `main`, [`infra/github-rulesets/main.json`](../../infra/github-rulesets/main.json),
with no bypass, not even for the owner: pull requests required (no review count), the checks `test`
(CI's job: type check, lint, tests and the migration check) and `write-gate`, both pinned to GitHub
Actions; force pushes and deletion blocked. The owner applies it, last:

```bash
gh api -X POST repos/johnrclem/hashtracks-web/rulesets --input infra/github-rulesets/main.json
```

After applying it, change the line below to `Main ruleset: REQUIRED` in a docs PR; from then on
the digest flags every day the ruleset is off.

Main ruleset: PENDING

Before applying it, give every open PR a `write-gate` status (a PR opened before the gate landed
has none and would wait forever): push to it, or add and remove any label. Once backfill PR 6 adds the `backfill-manifest` job, add it to `required_status_checks` the same
way (edit the file, then `gh api -X PUT repos/johnrclem/hashtracks-web/rulesets/<id> --input …`).
Check the pins on a scratch PR straight after applying it. A `write-gate` status set by
`github-actions[bot]` must satisfy the rule, and a status that someone posts with a personal token
must not. GitHub documents app pinning for checks and isn't explicit about commit statuses. If the
PR waits for "Expected" while the status exists, drop that check's `integration_id` and apply again.
Only the owner can post statuses then, and `agent-merge-pr.sh` still checks who set it. A gate run
that moves on after a push leaves the old head's `write-gate` status at pending. That's harmless.

#### Break glass

The ruleset has no bypass, so a broken gate blocks every merge, including the fix to the gate.
Switching it off is justified only for that: the gate or CI itself is broken (a GitHub outage, a
bug in `write-gate.yml` or its scripts, a required check that can no longer report), or prod needs a
fix that can't wait for a gate that won't pass. Not to save time on a review, and never for an agent.

1. GitHub → repository Settings → Rules → Rulesets → the `main` ruleset → Enforcement status
   **Disabled**. Note the time and why, in the PR you then merge.
2. Merge the fix (the gate fix first, if the gate is what broke).
3. Set Enforcement back to **Active** straight away, and check a fresh PR gets its `write-gate`
   status.

The digest checks the ruleset every morning and puts "ruleset off" first under "Needs you today"
for every day it stays disabled.

## Measures

The digest reports these; the targets say when to add repair capacity.

| Measure | Target |
|---|---|
| Finding to filed issue, median | under 90 minutes |
| Defect filed to fixed, median | 3 days or less |
| Open audit issues | flat or falling week over week |
| Open issues older than 30 days | none without a decision question |
| Alerts per week | 40 or fewer |
| Owner review latency | under 24 hours |

## Migrations

Prod changes only through committed migration files. On production builds Vercel runs
`prisma migrate deploy`, which applies each pending file. Two facts shape every rule below:

- **`migrate deploy` does not wrap a file in a transaction.** Each statement commits on its own,
  so a file that fails halfway leaves the first half applied (#2937). Checked on Prisma 7 on
  2026-11-14: a file of `CREATE TABLE`, `INSERT`, then a failing `INSERT` left the table in place.
- **A failed migration blocks every later deploy.** Its `_prisma_migrations` row stays unfinished
  until someone runs `prisma migrate resolve`, and until then no deploy can migrate.

### Template

Every new migration starts with `BEGIN;` and `SET LOCAL lock_timeout`, and ends with `COMMIT;`.
A failure then rolls back the whole file, and a migration waiting on a lock fails after 5 seconds
instead of stalling the site behind it.

```sql
-- <What this changes and why>. Refs #<issue>.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Inserts are idempotent: a re-run must be a no-op.
INSERT INTO "Kennel" (id, "kennelCode", …) VALUES ('knl_<code>', '<code>', …)
ON CONFLICT DO NOTHING;

-- Updates are guarded the same way.
UPDATE "Source" SET config = … WHERE id = 'src_<x>' AND config IS DISTINCT FROM …;

COMMIT;
```

Rules:

- **No other transaction control.** No `COMMIT` or `END` mid-file, no `ROLLBACK`, `ABORT`,
  `START TRANSACTION`, `COMMIT AND CHAIN` or savepoints.
- **Schema migrations too.** Generate with `npm run prisma -- migrate dev --create-only --name
  <change>`, add the three wrapper lines to the generated SQL, then run `npm run prisma -- migrate
  dev` to apply it locally.
- **`CREATE INDEX CONCURRENTLY`** can't run in a transaction, so it goes alone in a migration of
  its own, exactly one statement, whose first line is `-- migration: no-transaction (<reason>)`.
  (`ALTER TYPE … ADD VALUE` runs in a transaction on Postgres 12 and later; wrap it normally.)
- **Migration files are immutable once merged.** Editing one changes its checksum and blocks
  deploys. To change something, add a new migration. The one exception is fixing a migration that
  failed in prod and never applied (below); that PR carries the `migration-recovery` label.

CI enforces all of this on every pull request (`npm run check:migrations`, run by
`.github/workflows/ci.yml`). It checks only the migrations a PR adds or changes, using Postgres's
own parser (`src/lib/migration-sql/`).

### Dry run

Before a migration touches prod, dry-run it against prod and report the counts:

```bash
BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npm run migration:dry-run -- prisma/migrations/<dir>
```

`scripts/migration-dry-run.ts` reads `DATABASE_URL` from `.env`. It:

1. parses the file, and refuses it before connecting if it has transaction control other than one
   leading `BEGIN` and one trailing `COMMIT`, a psql meta-command like `\!`, or anything whose
   effect escapes a rollback (`COPY`, `CREATE EXTENSION`, `dblink`);
2. runs each statement through node-postgres inside one transaction, with `lock_timeout` 5 s and
   `statement_timeout` 60 s;
3. prints each statement's row count and the rows changed per table;
4. always rolls back, and checks that every statement ran in that one transaction.

It exits 0 when the dry run succeeded, 1 when a statement failed, 2 when it refused the file, and
3 if the transaction ended early (check the database at once).

**Never dry-run with `( echo 'BEGIN;'; cat migration.sql; echo 'ROLLBACK;' ) | psql`.** psql
commits at the file's own `COMMIT;`, so that command applies any file written to the template
above.

### When a migration fails in prod

Symptom: deploys stop migrating, and `npx prisma migrate status` lists a failed migration. The
row in `_prisma_migrations` has `finished_at IS NULL AND rolled_back_at IS NULL`. Only the owner
runs these steps, since each writes to prod.

1. **Find out what applied.** A file written to the template rolled back as a whole, so nothing
   applied. An older file without the wrapper may have applied its first statements: check each
   one against prod.
2. **If nothing applied:** fix the file in a PR labelled `migration-recovery` (it never applied
   anywhere, so editing it is safe; the label lets CI accept the edit; re-run CI after adding it).
   Then mark it rolled back and let the merge redeploy:
   `npx prisma migrate resolve --rolled-back <migration_name>`.
3. **If part applied:** either finish the remaining statements by hand and mark it applied
   (`npx prisma migrate resolve --applied <migration_name>`), or undo the applied part and mark it
   rolled back as in step 2. Dry-run any hand-written SQL first.
4. Check that `npx prisma migrate status` is clean and the next deploy migrates.
