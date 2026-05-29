/**
 * #1764 — strip leaked discrete-field labels from SDH3-kennel event
 * descriptions. Pre-#1316 imports baked "Hash Cash: … | Trail: … | Dog
 * Friendly: …" into `description`; those values are now first-class columns.
 * This removes the label segments from `description` (keeping `On After:` +
 * notes prose, which the current adapter still writes there) and backfills
 * the discrete columns when they're null and the label carried a value.
 *
 * Dry-run by default. Pass --apply to write. Targets the prod DB.
 *
 *   npx tsx scripts/cleanup-sdh3-description-labels.ts            # dry-run
 *   npx tsx scripts/cleanup-sdh3-description-labels.ts --apply    # write
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

// SDH3 hareline feeds these 10 San Diego kennels.
const SDH3_KENNELS = [
  "sdh3", "clh3-sd", "ljh3", "nch3-sd", "irh3-sd",
  "humpin-sd", "fmh3-sd", "hah3-sd", "mh4-sd", "drh3-sd",
];

const STRIP_LABEL_RE = /^(?:Hash Cash|Run Fee|Trail|Dog Friendly|Pre-?lube)\s*:/i;

function cleanDescription(segments: string[]): string | null {
  const kept = segments.filter((seg) => seg && !STRIP_LABEL_RE.test(seg));
  return kept.length ? kept.join(" | ") : null;
}

function parseDogFriendly(value: string): boolean | null {
  const v = value.trim().toLowerCase();
  if (/^(yes|y|true)\b/.test(v)) return true;
  if (/^(no|n|false)\b/.test(v)) return false;
  return null;
}

/** Pull "Label: value" segments so we can backfill null discrete columns. */
function extractLabels(segments: string[]): { cost?: string; trailType?: string; dogFriendly?: boolean | null } {
  const out: { cost?: string; trailType?: string; dogFriendly?: boolean | null } = {};
  for (const seg of segments) {
    const m = /^([^:]+):(.*)$/.exec(seg);
    if (!m) continue;
    const label = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (!value) continue;
    if ((label === "hash cash" || label === "run fee") && out.cost === undefined) out.cost = value;
    else if (label === "trail" && out.trailType === undefined) out.trailType = value;
    else if (label === "dog friendly" && out.dogFriendly === undefined) out.dogFriendly = parseDogFriendly(value);
  }
  return out;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL environment variable is required");
  const host = new URL(process.env.DATABASE_URL).host;
  console.log(`DB: ${host} | mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: SDH3_KENNELS } },
    select: { id: true, kennelCode: true },
  });
  const kennelIds = kennels.map((k) => k.id);

  const rows = await prisma.event.findMany({
    where: { kennelId: { in: kennelIds }, description: { contains: "Hash Cash:", mode: "insensitive" } },
    select: { id: true, date: true, description: true, cost: true, trailType: true, dogFriendly: true },
    orderBy: { date: "desc" },
  });

  console.log(`Found ${rows.length} events with a leaked "Hash Cash:" label.\n`);
  let changed = 0;
  for (const e of rows) {
    if (!e.description) continue;
    const segments = e.description.split(" | ").map((s) => s.trim());
    const labels = extractLabels(segments);
    const newDesc = cleanDescription(segments);
    const data: { description: string | null; cost?: string; trailType?: string; dogFriendly?: boolean } = {
      description: newDesc,
    };
    if (e.cost == null && labels.cost) data.cost = labels.cost;
    // Only backfill a short trail-type token ("A to A", "A to B"); never a
    // prose "Trail: head north…" segment that happened to share the prefix.
    if (e.trailType == null && labels.trailType && labels.trailType.length <= 12) data.trailType = labels.trailType;
    if (e.dogFriendly == null && typeof labels.dogFriendly === "boolean") data.dogFriendly = labels.dogFriendly;

    changed++;
    if (changed <= 5) {
      console.log(`${e.id} ${e.date.toISOString().slice(0, 10)}`);
      console.log(`  desc → ${JSON.stringify(newDesc)}`);
      if (data.cost || data.trailType || data.dogFriendly !== undefined) {
        console.log(`  backfill → cost=${data.cost ?? "(keep)"} trail=${data.trailType ?? "(keep)"} dog=${data.dogFriendly ?? "(keep)"}`);
      }
    }
    if (APPLY) await prisma.event.update({ where: { id: e.id }, data });
  }

  console.log(`\n${APPLY ? "Updated" : "Would update"} ${changed} events.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
