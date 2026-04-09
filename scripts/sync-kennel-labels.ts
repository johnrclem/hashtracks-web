/**
 * One-shot CLI entry point for the kennel label sync.
 *
 * Dry-run default; pass SYNC_APPLY=1 to actually POST/PATCH.
 *
 *   NODE_ENV=production npx tsx scripts/sync-kennel-labels.ts
 *   NODE_ENV=production SYNC_APPLY=1 npx tsx scripts/sync-kennel-labels.ts
 *
 * Mirrors the pattern of scripts/run-audit-issue-sync.ts — delegates all
 * real work to src/pipeline/kennel-label-sync.ts so the cron route and
 * this CLI share a single implementation.
 */

import "dotenv/config";
import { syncKennelLabels } from "@/pipeline/kennel-label-sync";

async function main(): Promise<void> {
  const apply = process.env.SYNC_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to GitHub)" : "DRY RUN (no writes)"}\n`);

  const result = await syncKennelLabels({ apply });

  console.log("\n── Summary ──");
  console.log(`Created:           ${result.created}`);
  console.log(`Updated (PATCH):   ${result.updated}`);
  console.log(`Already canonical: ${result.skippedCanonical}`);
  console.log(`Externally owned:  ${result.skippedExternal} (left alone)`);
  console.log(`Invalid kennel codes: ${result.invalidKennelCodes.length}`);
  console.log(`Errors:            ${result.errors.length}`);

  if (result.skippedExternal > 0) {
    const externals = result.actions.filter((a) => a.kind === "external");
    console.log("\nExternally-owned labels (first 10):");
    for (const a of externals.slice(0, 10)) {
      console.log(`  ${a.name} — ${"description" in a ? a.description ?? "(none)" : ""}`);
    }
  }

  if (result.invalidKennelCodes.length > 0) {
    console.log("\nInvalid kennel codes (first 10):");
    for (const c of result.invalidKennelCodes.slice(0, 10)) console.log(`  ${c}`);
  }

  if (result.errors.length > 0) {
    console.log("\nErrors (first 10):");
    for (const e of result.errors.slice(0, 10)) console.log(`  ${e}`);
    process.exitCode = 1;
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with SYNC_APPLY=1 to write.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
