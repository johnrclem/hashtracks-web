/**
 * Print every kennelCode that is fully seeded — present in KENNELS **and**
 * wired into at least one SOURCES[].kennelCodes — one per line, sorted.
 *
 * Used by scripts/copy-newest-handoff.sh (and the handoffs README audit
 * snippet) to decide whether a handoff is implemented (#2673). It imports the
 * seed-data modules instead of grepping their text, so the arrays it sees are
 * the evaluated values:
 *   - `kennelCodes: sfh3KennelCodes` (an identifier) resolves to its array;
 *   - a `kennelCodes: [` array split across many lines is just an array;
 *   - a kennelCode quoted elsewhere in sources.ts (a comment, a config
 *     string) no longer false-passes.
 * The seed-data files are plain data with no imports, so this never touches
 * the database (unlike prisma/seed.ts, which runs a full seed on import).
 *
 *   npx tsx scripts/print-seeded-kennel-codes.ts
 */
import { KENNELS } from "../prisma/seed-data/kennels";
import { SOURCES } from "../prisma/seed-data/sources";

/** Pure: kennelCodes present in `kennels` and linked by ≥1 source. Exported for tests. */
export function seededKennelCodes(
  kennels: ReadonlyArray<{ kennelCode: string }>,
  sources: ReadonlyArray<{ kennelCodes?: unknown }>,
): string[] {
  const linked = new Set<string>();
  for (const s of sources) {
    if (!Array.isArray(s.kennelCodes)) continue;
    for (const c of s.kennelCodes) if (typeof c === "string") linked.add(c);
  }
  const seeded = new Set(kennels.map((k) => k.kennelCode).filter((c) => linked.has(c)));
  return [...seeded].sort((a, b) => a.localeCompare(b));
}

if (process.argv[1]?.endsWith("print-seeded-kennel-codes.ts")) {
  const codes = seededKennelCodes(KENNELS, SOURCES as ReadonlyArray<{ kennelCodes?: unknown }>);
  if (codes.length === 0) {
    // An empty set would mark every handoff un-implemented — fail loud instead.
    console.error("print-seeded-kennel-codes: no seeded kennelCodes found — seed-data import broken?");
    process.exitCode = 1;
  } else {
    process.stdout.write(codes.join("\n") + "\n");
  }
}
