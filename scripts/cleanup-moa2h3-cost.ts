/**
 * One-shot cleanup for issue #1670 — MoA2H3 events stored with leading `$$`
 * or `* ` in the cost field.
 *
 * Production audit surfaced 7 events on the MoA2H3 kennel page whose `cost`
 * starts with the literal string "$$" or "* " (markdown-bullet leak). The
 * extraction code in this PR prevents the bug going forward; this script
 * normalises the stale rows so the kennel page renders clean values
 * immediately.
 *
 * Normalisation matches `normalizeCostSigil()` in `src/adapters/utils.ts`:
 *   - "$$10"            → "$10"
 *   - "* $10"           → "$10"
 *   - "$$10 - blurb"    → "$10 - blurb"
 *   - "$10"             → "$10"  (idempotent — no UPDATE issued)
 *
 * Safe to re-run.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { normalizeCostSigil } from "@/adapters/utils";

const KENNEL_CODE = "moa2h3";

async function main() {
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: KENNEL_CODE },
    select: { id: true, shortName: true },
  });
  if (!kennel) {
    // Throw rather than `process.exit(1)` — lets the `.finally()` at the
    // call site run `prisma.$disconnect()` instead of cutting the connection
    // mid-flight (Gemini + Claude PR review).
    throw new Error(`Kennel ${KENNEL_CODE} not found — aborting.`);
  }
  console.log(`Auditing ${kennel.shortName} (${kennel.id}) events for stale cost values…`);

  // Pull events where MoA2H3 is the PRIMARY kennel (not a co-host) — a
  // co-host normalization would rewrite values that legitimately belong to
  // sister kennels' rows in the rare case sister-kennel events linked to
  // this kennel exist (Codex adversarial review on the PR).
  const eventKennels = await prisma.eventKennel.findMany({
    where: { kennelId: kennel.id, isPrimary: true },
    select: { event: { select: { id: true, date: true, title: true, cost: true } } },
  });
  const STALE_COST_RE = /^(?:\*\s+|\$\$)/;
  const candidates = eventKennels
    .map((ek) => ek.event)
    .filter((e): e is typeof e & { cost: string } =>
      typeof e.cost === "string" && STALE_COST_RE.test(e.cost),
    );

  if (candidates.length === 0) {
    console.log("No stale cost values found — nothing to do.");
    return;
  }
  console.log(`Found ${candidates.length} candidate event(s):`);

  let updated = 0;
  for (const ev of candidates) {
    const clean = normalizeCostSigil(ev.cost);
    if (clean === ev.cost) {
      console.log(`  - ${ev.date.toISOString().slice(0, 10)} ${ev.title ?? "(no title)"} — already clean (${ev.cost})`);
      continue;
    }
    await prisma.event.update({
      where: { id: ev.id },
      data: { cost: clean },
    });
    console.log(`  ✓ ${ev.date.toISOString().slice(0, 10)} ${ev.title ?? "(no title)"} — "${ev.cost}" → "${clean}"`);
    updated += 1;
  }
  console.log(`Done. Normalised ${updated} of ${candidates.length} candidate event(s).`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Explicit disconnect so Railway logs don't show a truncated connection;
    // `process.exitCode` (not `process.exit`) lets this `.finally` run before
    // the event loop drains. Pattern recommended by Gemini + Claude review.
    await prisma.$disconnect();
  });
