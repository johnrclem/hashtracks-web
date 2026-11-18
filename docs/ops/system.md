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
  `onboarding-candidate` until 2026-12-18; `schema-gap` → `lane:decision`; anything else →
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
- **Secrets never reach GitHub from the server.** Every issue body and comment the server files
  passes through `scrubSecrets` (`src/lib/audit-redact.ts`): `key=`/`token=`/`sig=` query values,
  `AIza…` keys, bearer tokens, URL credentials and the like. `scripts/scrub.ts` uses the same
  patterns.
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

Scheduled tasks act on GitHub through `gh`. Today `gh` is logged in as the owner, so an agent's PR
looks like the owner's. **Building (S4):** a "HashTracks Agent" GitHub App that every task acts
as, set up through an agent root (`~/Developer/hashtracks-agents/`) whose settings give each session
an empty `gh` config and a `gh` shim that mints the App's token; and a "HashTracks Server" App
for the server's own GitHub reads and writes.

**Preflight.** Step 1 of every task runs this, before anything else (it's in the task's manual, or
in its prompt for the deep dive and the hareline audit, which have no manual of their own):

```bash
FLAG=$(curl -fsSL --max-time 20 https://raw.githubusercontent.com/johnrclem/hashtracks-web/main/docs/ops/system.md | grep -m1 '^Identity preflight:'); LOGIN=$(gh api user --jq .login 2>/dev/null); echo "preflight: login=${LOGIN:-unknown} | ${FLAG:-flag missing}"; case "$FLAG" in "Identity preflight: LOG"*|"Identity preflight: STOP unless $LOGIN") echo "preflight: OK" ;; *) echo "preflight: STOP" ;; esac
```

It prints the login the run acts as, which each task puts in its report. If it prints
`preflight: STOP`, the run stops before any other step. The digest is the one exception: it
writes nothing to GitHub, so it carries on and reports the failure first under "Needs you today". It reads this flag, on `main`:

Identity preflight: LOG

While the flag is `LOG`, the preflight only logs. S4 switches it, once the Apps exist, the root is
set up, every task is re-pointed to the root and each of the six has logged the bot's login on a
real scheduled run, by changing the line to exactly `Identity preflight: STOP unless <bot login>`.
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

What holds today:

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

**Building (S4):** GitHub enforces the gates, not the prompts.

- **One ruleset on `main`,** with no bypass, not even for the owner: pull requests required;
  required checks tsc, lint, tests and `write-gate`; force pushes blocked. **Break glass:** the
  owner switches the ruleset off in GitHub settings only to recover from an outage the gate itself
  causes, and the digest flags every day it stays off.
- **`write-gate.yml`** runs on `pull_request_target` from main's definition and reads the PR's
  files as data, never running its code. It stamps the approval when `owner-approved` is added by
  the owner's login (`OWNER_GITHUB_LOGIN`) and ignores the label from anyone else; it classifies the
  PR as `write:docs`, `write:code`, `write:migration` or `write:insert-auto`; and it passes the PR
  in one of these cases:
  - **A valid approval:** the label is on the PR now, the newest label event was the owner's, and
    the head is the stamped head, apart from merges of `main`. Removing the label revokes it.
  - **Owner-authored and low-risk:** a branch outside the agent prefixes above, no migration, no
    `.github/workflows/**`. The digest lists every PR that passed this way in the last 24 hours.
  - **Bot-authored and data-only:** every file in `docs/kennel-onboarding/handoffs/**`,
    `run-log.md`, `target-queue.md` or `source-platform-notes.md`. Never a `*-prompt.md`,
    `docs/ops/**`, `.claude/**` or `CLAUDE.md`.
  - **The auto tier (S5):** an onboarding migration that only inserts new rows.

  A PR that touches `.github/workflows/**` fails without a valid approval.
- **`scripts/agent-merge-pr.sh`** re-reads the `write-gate` status and merges with
  `gh pr merge --squash --match-head-commit <head sha>`, so the merge is bound to the checked commit.

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
