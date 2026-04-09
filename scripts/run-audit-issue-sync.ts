/**
 * Manual entry point to invoke the audit issue sync without going through
 * the deployed cron route. Useful for the first-ever sync immediately
 * after the label backfill, before the cron is live in prod.
 *
 * Usage:  NODE_ENV=production npx tsx scripts/run-audit-issue-sync.ts
 */
import "dotenv/config";
import { syncAuditIssues } from "@/pipeline/audit-issue-sync";

syncAuditIssues()
  .then((result) => {
    console.log("\nFinal result:", JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
