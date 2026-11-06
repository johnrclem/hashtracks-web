/**
 * One-shot canonical-Event fixes for HC audit findings (Nov 2026). These runs are past,
 * and HC's getEvents is future-only, so a re-scrape never revisits them: the stored
 * canonical row must be corrected directly. RawEvents are left untouched (immutable).
 * Every UPDATE is guarded on the current (audited) value, so a re-run is a no-op.
 *
 *   #2577 Fengyuan #10 "Midnight Marauders" — HC 23:59 is genuine (hares away 00:01);
 *         the frozen backfill's 06:00–21:59 gate dropped it.
 *   #2572 DAFT — 5 runs whose only venue is a what3words link; the URL was dropped
 *         as location text. Store it as the maps link (locationAddress).
 *   #2554 BeerSpoke — HC put global ids (1908/1909/1905) in the run-number slot for
 *         "Beerspoke 51/52/53"; the inflated values drive the "Latest Run" stat.
 *   #2590 Newcastle — 5 "Placeholder event for NH3" stubs. HC still has no data; the
 *         kennel's hareline sheet has venue + hares. Title becomes the adapter's
 *         fallback "Newcastle H3 #N". The 2026-04-05 #1943 stub duplicates the real
 *         #1943 on 04-08 and is hard-deleted (owner-approved).
 *
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/fix-hc-canonicals-nov-2026.ts
 *   Apply:    BACKFILL_APPLY=1 BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/fix-hc-canonicals-nov-2026.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";

interface Fix {
  id: string;
  label: string;
  /** Field values the row must currently have for the fix to apply. */
  expect: Record<string, string | number | null>;
  set: Record<string, string | number>;
}

const NH3_PLACEHOLDER = "Placeholder event for NH3";

const FIXES: Fix[] = [
  { id: "cmr8gfekl000jqthnsub88mx0", label: "fishhh #10", expect: { startTime: null }, set: { startTime: "23:59" } },
  { id: "cmr3ru7sf000x0ihnv3a89lnd", label: "dafth3 #668", expect: { locationAddress: null }, set: { locationAddress: "https://w3w.co/hunter.flips.rear" } },
  { id: "cmr3ru8pg001b0ihn5z004z48", label: "dafth3 #675", expect: { locationAddress: null }, set: { locationAddress: "https://w3w.co/souk.rods.weeks" } },
  { id: "cmr3ru93n001h0ihnqqrkwmx1", label: "dafth3 #678", expect: { locationAddress: null }, set: { locationAddress: "https://w3w.co/drain.bonnet.crumbles" } },
  { id: "cmr3ru981001j0ihnzxtnowwg", label: "dafth3 #679", expect: { locationAddress: null }, set: { locationAddress: "https://w3w.co/afterglow.summaries.after" } },
  { id: "cmr3ruajl00230ihnjzovncz3", label: "dafth3 #689", expect: { locationAddress: null }, set: { locationAddress: "https://w3w.co/shiny.save.potato" } },
  { id: "cmr3rvs5g00273mhnkzduqqex", label: "beerspoke 51", expect: { runNumber: 1908 }, set: { runNumber: 51 } },
  { id: "cmr3rvs9o00293mhnecos16d9", label: "beerspoke 52", expect: { runNumber: 1909 }, set: { runNumber: 52 } },
  { id: "cmr3rvsel002b3mhnfsz93090", label: "beerspoke 53", expect: { runNumber: 1905 }, set: { runNumber: 53 } },
  {
    id: "cmr3rjnhz004ni4hnpwiyzow9", label: "newcastle #1936", expect: { title: NH3_PLACEHOLDER },
    set: { title: "Newcastle H3 #1936", locationName: "Blackbird Inn, North Rd, Ponteland NE20 9UH", haresText: "Ma Bottom" },
  },
  {
    id: "cmr3rjo7v004zi4hnnefdp0c3", label: "newcastle #1942", expect: { title: NH3_PLACEHOLDER },
    set: { title: "Newcastle H3 #1942", locationName: "Mosaic Tap, 25 Pink Ln, Newcastle upon Tyne NE1 5DW", haresText: "TC & Octopushy" },
  },
  {
    id: "cmr3rjph5005ji4hnl0d49isf", label: "newcastle #1951", expect: { title: NH3_PLACEHOLDER },
    set: { title: "Newcastle H3 #1951", locationName: "The Welcome Tavern, 10 Prospect Row, Sunderland SR1 2DZ", haresText: "Totem Pole" },
  },
  {
    id: "cmr3rjpm0005li4hnnkbf3bxg", label: "newcastle #1952", expect: { title: NH3_PLACEHOLDER },
    set: { title: "Newcastle H3 #1952", locationName: "The Pavillion, Backworth NE27 0FG", haresText: "Sperminator & Just-Dave & Mindphuck" },
  },
];

/** 2026-04-05 #1943 placeholder — duplicate of the real #1943 (2026-04-08). */
const DUPLICATE_ID = "cmr3rjocs0051i4hn076lpzim";

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  let applied = 0;
  for (const fix of FIXES) {
    const row = await prisma.event.findUnique({ where: { id: fix.id } });
    if (!row) {
      console.log(`  SKIP ${fix.label}: event gone`);
      continue;
    }
    const current = row as unknown as Record<string, unknown>;
    const mismatch = Object.entries(fix.expect).find(([k, v]) => current[k] !== v);
    if (mismatch) {
      console.log(`  SKIP ${fix.label}: ${mismatch[0]} is ${JSON.stringify(current[mismatch[0]])}, expected ${JSON.stringify(mismatch[1])}`);
      continue;
    }
    const diff = Object.entries(fix.set).map(([k, v]) => `${k}: ${JSON.stringify(current[k])} → ${JSON.stringify(v)}`);
    console.log(`  ${fix.label}  ${diff.join("; ")}`);
    if (apply) {
      const res = await prisma.event.updateMany({ where: { id: fix.id, ...fix.expect }, data: fix.set });
      applied += res.count;
    }
  }

  const dup = await prisma.event.findUnique({ where: { id: DUPLICATE_ID }, select: { title: true, date: true } });
  const dupLabel = dup ? `${dup.title} ${dup.date.toISOString().slice(0, 10)}` : "already gone";
  console.log(`  DELETE ${DUPLICATE_ID}: ${dupLabel}`);
  if (apply && dup?.title === NH3_PLACEHOLDER) {
    await deleteLeakedEvent(prisma, DUPLICATE_ID, ["hares", "attendances", "kennelAttendances"]);
  }
  console.log(apply ? `\nApplied ${applied} updates.` : "\nDry run complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
