/**
 * One-shot canonical backfill for Sek Kong H3 stale hares/description leaked
 * from a since-blanked source row (#2237).
 *
 * Why this is needed: the google-sheets adapter now emits `null` (explicit clear)
 * for a blank/placeholder cell in a configured column, which self-heals on the
 * next scrape after deploy (the null re-fingerprints the raw → merge full-update
 * clears the field). This script applies that same correction to the ALREADY
 * stored canonical events immediately, so the leak (#2501 carrying #2500's
 * "GM + Committee" / "2,500th Run" after its own row went blank) is fixed now
 * rather than waiting for the deploy + next daily scrape.
 *
 * Mechanism: Sek Kong has a single source (the hareline sheet, trust 7). For each
 * canonical event, the most-recent sheet RawEvent reflects the current sheet row.
 * Where that raw carries NO hares/description (the row is blank) but the canonical
 * still holds a value, the value is stale → clear it to null. Events whose raw
 * still carries the value are left untouched (e.g. #2500 keeps "GM + Committee").
 *
 * Safe & idempotent: only clears (never invents), optimistic value guard on
 * UPDATE, single-source kennel so there is no cross-source value to preserve, and
 * the cleared null STICKS (haresText/description are not part of the fingerprint;
 * the deployed adapter's `undefined` for a blank cell preserves the null).
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: DATABASE_URL=... BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-sekkong-blank-clear-2237.ts
 *   Apply:   DATABASE_URL=... BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-sekkong-blank-clear-2237.ts --apply
 */
import { runOneShot } from "./lib/one-shot";

const SEKKONG_SHEET_NAME = "Sek Kong H3 Hareline Sheet";

type SekEvent = {
  id: string;
  runNumber: number | null;
  haresText: string | null;
  description: string | null;
  dateUtc: Date | null;
};

/** Decide which fields are stale (canonical holds a value the current sheet raw
 *  no longer carries). A missing raw clears nothing — the row is left alone. */
function planClears(e: SekEvent, rawData: unknown): { clearHares: boolean; clearDesc: boolean } {
  const data = rawData as { hares?: unknown; description?: unknown } | null;
  const rawHasHares = typeof data?.hares === "string" && data.hares.trim() !== "";
  const rawHasDesc = typeof data?.description === "string" && data.description.trim() !== "";
  return {
    clearHares: e.haresText != null && !rawHasHares,
    clearDesc: e.description != null && !rawHasDesc,
  };
}

/** Single-template log line (no nested template literals). */
function describeClears(e: SekEvent, clearHares: boolean, clearDesc: boolean): string {
  const date = e.dateUtc?.toISOString().slice(0, 10) ?? "?";
  const parts: string[] = [];
  if (clearHares) parts.push(`hares "${e.haresText}" → null`);
  if (clearDesc) parts.push(`desc "${(e.description ?? "").slice(0, 30)}…" → null`);
  return `   - #${e.runNumber ?? "?"} ${date}: ${parts.join(" | ")}`;
}

void runOneShot(async ({ prisma, apply }) => {
  const source = await prisma.source.findFirst({
    where: { name: SEKKONG_SHEET_NAME },
    select: { id: true },
  });
  if (!source) {
    console.log(`Source "${SEKKONG_SHEET_NAME}" not found — nothing to do.`);
    return;
  }

  // Canonical events that still hold a hares or description value.
  const events = await prisma.event.findMany({
    where: {
      eventKennels: { some: { kennel: { kennelCode: "sekkong-h3" } } },
      OR: [{ haresText: { not: null } }, { description: { not: null } }],
    },
    select: { id: true, runNumber: true, haresText: true, description: true, dateUtc: true },
    orderBy: { date: "asc" },
  });

  // Plan the clears: compare each canonical event against its latest sheet raw.
  const plan = [];
  for (const e of events) {
    const raw = await prisma.rawEvent.findFirst({
      where: { eventId: e.id, sourceId: source.id },
      orderBy: { scrapedAt: "desc" },
      select: { rawData: true },
    });
    if (!raw) continue; // no sheet raw linked — leave alone
    const { clearHares, clearDesc } = planClears(e, raw.rawData);
    if (!clearHares && !clearDesc) continue;
    plan.push({
      id: e.id,
      oldHares: e.haresText,
      oldDesc: e.description,
      clearHares,
      clearDesc,
      line: describeClears(e, clearHares, clearDesc),
    });
  }

  console.log(`\n#2237 Sek Kong stale hares/description from blanked source rows: ${plan.length} event(s)`);
  plan.forEach((p) => console.log(p.line));

  if (apply) {
    let haresCleared = 0;
    let descCleared = 0;
    for (const p of plan) {
      if (p.clearHares) {
        const res = await prisma.event.updateMany({
          where: { id: p.id, haresText: p.oldHares },
          data: { haresText: null },
        });
        haresCleared += res.count;
      }
      if (p.clearDesc) {
        const res = await prisma.event.updateMany({
          where: { id: p.id, description: p.oldDesc },
          data: { description: null },
        });
        descCleared += res.count;
      }
    }
    console.log(`   ✏️  cleared ${haresCleared} hares, ${descCleared} description`);
  }
  console.log(`\n${apply ? "Applied." : "Dry run complete — re-run with --apply to write."}`);
});
