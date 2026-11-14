# HashTracks ops system

How HashTracks keeps about 460 changing sources accurate and keeps adding kennels: the work
queue, the automations, the gates on prod writes, and what to do when one breaks. Every task
manual links here.

This page is being built in steps. The migrations section is complete; lanes, automations and
gates follow.

## Migrations

Prod changes only through committed migration files. On production builds Vercel runs
`prisma migrate deploy`, which applies each pending file. Two facts shape every rule below:

- **`migrate deploy` does not wrap a file in a transaction.** Each statement commits on its own,
  so a file that fails halfway leaves the first half applied (#2937).
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
- **Statements that can't run in a transaction** (`CREATE INDEX CONCURRENTLY`, `ALTER TYPE … ADD
  VALUE`) go in a migration of their own, containing only such statements, whose first line is
  `-- migration: no-transaction (<reason>)`.
- **Migration files are immutable once merged.** Editing one changes its checksum and blocks
  deploys. To change something, add a new migration.

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
2. **If nothing applied:** fix the file (it never ran anywhere, so editing it is safe), then mark
   it rolled back and redeploy:
   `npx prisma migrate resolve --rolled-back <migration_name>`.
3. **If part applied:** either finish the remaining statements by hand and mark it applied
   (`npx prisma migrate resolve --applied <migration_name>`), or undo the applied part and mark it
   rolled back as in step 2. Dry-run any hand-written SQL first.
4. Check that `npx prisma migrate status` is clean and the next deploy migrates.
