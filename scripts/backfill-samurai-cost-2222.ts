/**
 * One-shot canonical backfill for #2222 — Samurai H3 Fee → cost.
 *
 * Why this is needed: the adapter now emits the "Fee" column as the typed
 * `cost` field, but a plain re-scrape only fixes events still in the source's
 * forward window. Historical Samurai events created before the fix have the fee
 * embedded only in their `description` ("…\nFee: 500jpy (BYO)\n…") with
 * `cost = NULL`. This script lifts the Fee line into `cost` for those rows.
 *
 * Safe & idempotent: scoped to the samurai-h3 kennel, only touches rows where
 * `cost IS NULL`, uses an optimistic guard (updateMany WHERE cost: null), and a
 * re-run matches 0 rows. `cost` is NOT part of the RawEvent fingerprint, so this
 * never disturbs dedup, and the merge pipeline preserves the value going forward.
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-samurai-cost-2222.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-samurai-cost-2222.ts --apply
 */
import { runOneShot } from "./lib/one-shot";

const SAMPLE = 10;

/** Pull the value from a "Fee: …" line in the folded description, if present. */
function extractFee(description: string | null): string | undefined {
  if (!description) return undefined;
  for (const line of description.split("\n")) {
    const m = /^Fee:\s*(.+)$/.exec(line.trim());
    if (m && m[1].trim()) return m[1].trim();
  }
  return undefined;
}

void runOneShot(async ({ prisma, apply }) => {
  const candidates = await prisma.event.findMany({
    where: {
      cost: null,
      description: { contains: "Fee:" },
      eventKennels: { some: { kennel: { kennelCode: "samurai-h3" } } },
    },
    select: { id: true, title: true, description: true },
    orderBy: { date: "asc" },
  });

  const plan = candidates
    .map((e) => ({ id: e.id, title: e.title, fee: extractFee(e.description) }))
    .filter((p): p is { id: string; title: string | null; fee: string } => !!p.fee);

  console.log(
    `\n#2222 Samurai H3 Fee → cost: ${plan.length} event(s) (of ${candidates.length} with a "Fee:" line and null cost)`,
  );
  plan.slice(0, SAMPLE).forEach((p) => console.log(`   - ${p.title}: cost="${p.fee}"`));

  if (apply) {
    let n = 0;
    for (const p of plan) {
      const res = await prisma.event.updateMany({
        where: { id: p.id, cost: null },
        data: { cost: p.fee },
      });
      n += res.count;
    }
    console.log(`   ✏️  updated ${n}`);
  }

  console.log(`\n${apply ? "Applied." : "Dry run complete — re-run with --apply to write."}`);
});
