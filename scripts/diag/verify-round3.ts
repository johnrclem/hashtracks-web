import "dotenv/config";
import { prisma } from "../../src/lib/db";
import { getAdapter } from "../../src/adapters/registry";

async function run(name: string, eventMatch: RegExp, fields: string[]) {
  const source = await prisma.source.findFirst({ where: { name } });
  if (!source) { console.log(`MISSING ${name}`); return; }
  console.log(`\n=== ${name} ===`);
  const adapter = getAdapter(source.type);
  const result = await adapter.fetch(source, { days: 400 });
  console.log(`events=${result.events.length}`);
  for (const e of result.events) {
    const dateStr = typeof e.date === "string" ? e.date.slice(0, 10) : (e.date as Date).toISOString().slice(0, 10);
    const title = (e.title ?? "").toString();
    const hares = (e.hares ?? "").toString();
    const loc = (e.location ?? "").toString();
    if (eventMatch.test(title) || eventMatch.test(hares) || eventMatch.test(loc)) {
      console.log(`  ${dateStr} title="${title}" hares="${hares}" loc="${loc}" kennel=${e.kennelTag}`);
    }
  }
}

(async () => {
  // #809 BAH3: phone-in-hares, event #2024 "Any Cock'll Do Me..."
  await run("Baltimore Annapolis GCal", /Any Cock|Do Me/i, ["hares"]);
  // #807 Stuttgart SH3: "SH3 #880 Hare: Kiss Me- Degerloch"
  await run("Stuttgart H3 Google Calendar", /SH3|Kiss Me|Degerloch/i, ["title","hares"]);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
