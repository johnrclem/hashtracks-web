/**
 * One-shot cleanup for #1846: OKissMe H3 canonical Event.description rows carry
 * a bare city name ("Orlando", "Kissimmee", "Not Oviedo", "St. Cloud", …) that
 * leaked from an earlier source config which mapped `description` to the sheet's
 * Location column (col 3, the city). The current/seeded config maps description
 * to the Trail Notes column instead, so nothing re-introduces the city — but the
 * leftover city descriptions persist on the existing canonical Events (merge
 * treats an undefined description as "preserve existing").
 *
 * Provenance guard (precise, not "nuke all descriptions"):
 *   Clear an okissme-h3 Event.description ONLY when it exactly matches the
 *   Location (col 3) cell for that run number in the live sheet. That is the
 *   signature of the old col-3 leak; a real Trail Notes blurb ("Awesome Dive
 *   Bar!", "Airboat Ride (On location)") never equals the city, so it is left
 *   alone. RawEvents are immutable and untouched.
 *
 * Usage (Railway's public proxy uses a self-signed cert → allow it for the pool):
 *   Dry run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-okissme-h3-descriptions.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-okissme-h3-descriptions.ts --apply
 *   Env:     DATABASE_URL
 */
import "dotenv/config";
import type { PrismaClient } from "@/generated/prisma/client";
import { parseCSV } from "@/adapters/google-sheets/adapter";
import { runFieldPatchCleanup, resolveCleanupKennel, type FieldPatch } from "./lib/cleanup-cli";

const KENNEL_CODE = "okissme-h3";
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/1MMS96JayUN3TBITvmLyc-TQH9RvjzcHcPwjn2cGHoVs/export?format=csv&gid=223708191";
// Column indices match the OKissMe source config: Number(0), …, Location(3).
const COL_RUN = 0;
const COL_LOCATION = 3;

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

async function collect(prisma: PrismaClient): Promise<FieldPatch[]> {
  const kennel = await resolveCleanupKennel(prisma, KENNEL_CODE);
  if (!kennel) return [];

  // Build runNumber → Location(col 3) city map from the live sheet.
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Failed to fetch OKissMe CSV: HTTP ${res.status}`);
  const cityByRun = new Map<number, string>();
  for (const row of parseCSV(await res.text())) {
    const run = Number.parseInt(row[COL_RUN]?.trim() ?? "", 10);
    const city = row[COL_LOCATION]?.trim();
    if (!Number.isNaN(run) && city) cityByRun.set(run, city);
  }
  console.log(`Loaded ${cityByRun.size} run→Location entries from the sheet.`);

  const events = await prisma.event.findMany({
    where: { kennelId: kennel.id, description: { not: null } },
    select: { id: true, runNumber: true, description: true },
  });

  const patches: FieldPatch[] = [];
  for (const e of events) {
    const city = e.runNumber != null ? cityByRun.get(e.runNumber) : undefined;
    if (city && norm(city) === norm(e.description)) {
      patches.push({ kennelLabel: kennel.shortName, eventId: e.id, field: "description", before: e.description, after: null });
    }
  }
  return patches;
}

runFieldPatchCleanup(collect).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
