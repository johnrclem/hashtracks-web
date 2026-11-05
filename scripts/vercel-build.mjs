#!/usr/bin/env node
/**
 * Vercel build entry point (`vercel.json` buildCommand + `npm run vercel-build`).
 *
 * Vercel runs the build command for BOTH production and preview deployments,
 * and preview deployments share the production `DATABASE_URL`. The previous
 * build command ran `prisma migrate deploy` unconditionally, so pushing any
 * branch that carried a new migration applied it to the production database
 * before the PR was reviewed or merged (PR #2675 documented exactly this).
 *
 * Behaviour now:
 *   - `VERCEL_ENV=production` → `prisma migrate deploy`, then `next build`.
 *   - anything else (preview, development, unset/local) → read-only
 *     `prisma migrate status` (non-fatal, so the build log still surfaces
 *     pending migrations), then `next build`. Migrations never apply.
 *
 * Tradeoff: a preview of a schema-changing PR runs against the un-migrated
 * production schema, so routes touching new columns may error on the preview
 * URL. That is strictly better than mutating prod from an unmerged branch.
 *
 * Set VERCEL_BUILD_DRY_RUN=1 to print the planned commands without running
 * them (used by scripts/vercel-build.test.ts).
 */
import { spawnSync } from "node:child_process";

const vercelEnv = process.env.VERCEL_ENV;
const isProduction = vercelEnv === "production";
const dryRun = process.env.VERCEL_BUILD_DRY_RUN === "1";

function log(message) {
  process.stdout.write(`[vercel-build] ${message}\n`);
}

/** Run a command, inheriting stdio. Exits the process on failure when `fatal`. */
function run(cmd, args, { fatal }) {
  const line = `${cmd} ${args.join(" ")}`;
  if (dryRun) {
    process.stdout.write(`DRY RUN: ${line}\n`);
    return 0;
  }
  log(`$ ${line}`);
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  const status = result.status ?? 1;
  if (status !== 0 && fatal) process.exit(status);
  return status;
}

if (isProduction) {
  log("VERCEL_ENV=production — applying pending migrations");
  run("npx", ["prisma", "migrate", "deploy"], { fatal: true });
} else {
  log(
    `skipping migrate deploy (VERCEL_ENV=${vercelEnv ?? "unset"}) — ` +
      "migrations apply only on production builds",
  );
  const status = run("npx", ["prisma", "migrate", "status"], { fatal: false });
  if (status !== 0) {
    log(
      "migrate status reported pending or unknown migrations " +
        "(non-fatal outside production; they apply when the PR merges to main)",
    );
  }
}

run("npx", ["next", "build"], { fatal: true });
