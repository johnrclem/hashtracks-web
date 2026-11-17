# HashTracks ops system

How HashTracks keeps about 460 changing sources accurate and keeps adding kennels: the work
queue, the automations, the gates on prod writes, and what to do when one breaks. Every task
manual links here.

It describes what runs today. Planned changes are marked **planned**: the ops plan adds lane
labels, a watchdog, bot identities and an auto-approve tier for insert-only onboarding migrations
over the coming weeks, and this page changes as each one lands.

## The three loops

| Loop | Detects | Repairs | Where the work waits |
|---|---|---|---|
| **Scraper health** | Each scrape writes a `ScrapeLog`; `src/pipeline/health.ts` raises `Alert` rows | A supervised session, from `/admin/alerts` | `/admin/alerts`; the "File GitHub Issue" button |
| **Data quality** | The daily audit cron, the kennel deep dive and the hareline audit submit findings | The audit fixer task, through `audit-fix` PRs | GitHub issues labelled `audit` |
| **Coverage** | The daily onboarding task researches one kennel and writes a handoff | The implementer task builds config-only handoffs into `onboarding-impl` PRs; history backfills are applied by the owner | `docs/kennel-onboarding/`, `onboarding-impl` PRs |

Detection doesn't wait on repair. If a queue grows two weeks running, add repair capacity;
don't throttle the audits.

## How a finding becomes an issue

1. A finding is submitted as an `AuditFindingDraft` row (`PENDING`) through the agent API
   (`/api/audit/agent/*`) or by the audit cron.
2. The promoter (`src/pipeline/audit-draft-promoter.ts`) files it as a GitHub issue, deduped
   against open issues. It runs hourly via QStash, with the daily 14:00 UTC Vercel cron as a
   backstop, under a transaction-scoped advisory lock so two runs never file the same draft. If
   GitHub can't answer the dedup check, the draft stays `PENDING` and is retried next hour.
3. The mirror cron (`/api/cron/sync-audit-issues`, 12:30 UTC) copies `audit` issues into
   `AuditIssue` for `/admin/audit`.
4. An issue closes only after a prod scrape or a page check confirms the fix.

A `PENDING` draft older than 2 hours means filing is stuck: the daily digest flags it.

**Planned:** every issue gets exactly one lane label (`lane:incident`, `lane:defect`,
`lane:coverage`, `lane:decision`, `lane:ops`), and the mirror syncs lanes too.

## Automations

**Vercel crons** (`vercel.json`, UTC): scrape dispatch 06:00 (fans out per-source scrapes
through QStash), audit 12:00, audit-issue mirror 12:30, finding promoter 14:00 (backstop),
travel-draft GC 03:00, scrape-log GC 03:30, Strava cache purge 03:45, prediction ledger Monday
08:00, rule drift Monday 09:00.

**QStash schedules** (`scripts/setup-qstash-schedule.ts`, run once by the owner after a change):
the hourly finding promoter.

**Scheduled tasks on the Mac mini** (Claude Code, local time; each `SKILL.md` follows a manual in
this repo):

| Task | When | Manual | Output |
|---|---|---|---|
| `hashtracks-kennel-deep-dive` | 5 times a day | agent API prompts | findings via `/api/audit/agent/*` |
| `hashtracks-hareline-audit` | daily 08:30 | agent API prompts | findings via `/api/audit/agent/*` |
| `hashtracks-ops-digest` | daily 07:15 | [`daily-digest-task.md`](daily-digest-task.md) | `~/Developer/hashtracks-ops-digests/<date>.md`, phone push when something needs the owner |
| `hashtracks-audit-fixer` | daily 10:30 | [`audit-fixer-task.md`](audit-fixer-task.md) | `audit-fix` PRs |
| `hashtracks-kennel-onboarding` | daily 03:00 | [`daily-onboarding-prompt.md`](../kennel-onboarding/daily-onboarding-prompt.md) | handoff PRs (docs only) |
| `hashtracks-kennel-implement` | daily 05:00 | [`implement-handoff-prompt.md`](../kennel-onboarding/implement-handoff-prompt.md) | `onboarding-impl` PRs |

An automation that runs but produces nothing is down. Today the digest is the only check;
**planned:** a watchdog judges each automation by the side effects it must leave (AuditLog rows,
drafts, agent API calls, PRs, scrape logs) and emails the owner when one stops.

## Gates on prod writes

- **Agents never write to prod.** Prod changes through committed migrations, applied by
  `migrate deploy` on the production build, or through owner-run scripts.
- **The owner approves every agent PR that writes data:** the `owner-approved` label on an
  `audit-fix` or `onboarding-impl` PR. Agents never add that label.
- **Every prod write is dry-run first, with counts shown to the owner:** migrations with the
  dry-run tool below; backfills and cleanups with their own dry-run mode
  (`.claude/rules/prod-data-ops.md`).
- **Never run `prisma db seed` against prod.** Seed data reaches prod only through a migration.
- **History backfills** are applied by the owner (`BACKFILL_APPLY=1`). Automating them is
  designed in [`docs/onboarding-backfill-automation-design.md`](../onboarding-backfill-automation-design.md).

**Planned:** branch protection with a single `write-gate` check, GitHub App identities for the
server and the agents, and an auto-approve tier for onboarding migrations that only insert new
kennels.

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
