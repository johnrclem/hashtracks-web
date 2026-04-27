import "dotenv/config";
import { ChiangMaiHHHAdapter } from "@/adapters/html-scraper/chiangmai-hhh";
import type { Source } from "@/generated/prisma/client";

const KENNELS = [
  { harelineKey: "ch3", path: "/ch3-hareline/" },
  { harelineKey: "ch4", path: "/ch4-hareline/" },
  { harelineKey: "cgh3", path: "/cgh3-hareline/" },
  { harelineKey: "csh3", path: "/csh3-hareline/" },
  { harelineKey: "cbh3", path: "/cbh3-hareline/" },
] as const;

async function main() {
  const adapter = new ChiangMaiHHHAdapter();
  let totalEvents = 0;
  let titleSetCount = 0;

  for (const { harelineKey, path } of KENNELS) {
    const source = {
      id: `verify-${harelineKey}`,
      url: `http://www.chiangmaihhh.com${path}`,
      config: { harelineKey },
      scrapeDays: 365,
    } as unknown as Source;

    process.stdout.write(`\n=== ${harelineKey.toUpperCase()} (${path}) ===\n`);
    const result = await adapter.fetch(source, { days: 365 });
    if (result.errors?.length) {
      process.stdout.write(`  errors: ${JSON.stringify(result.errors)}\n`);
    }
    process.stdout.write(`  events: ${result.events.length}\n`);
    if (result.events.length > 0) {
      const sample = result.events[0];
      process.stdout.write(`  sample: ${JSON.stringify(sample)}\n`);
    }
    totalEvents += result.events.length;
    for (const e of result.events) {
      if (e.title !== undefined) titleSetCount++;
    }
  }

  process.stdout.write(
    `\n=== Summary: ${totalEvents} events across 5 kennels, ${titleSetCount} with title set (expect 0) ===\n`,
  );
  if (titleSetCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
