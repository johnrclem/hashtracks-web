import "dotenv/config";
import { prisma } from "../../src/lib/db";
import { getAdapter } from "../../src/adapters/registry";

(async () => {
  const source = await prisma.source.findFirst({ where: { name: "Stuttgart H3 Google Calendar" } });
  if (!source) { console.log("MISSING"); return; }
  // Simulate post-seed config with new titleHarePattern
  const patched = {
    ...source,
    config: {
      ...(source.config as object),
      titleHarePattern: "Hare:?\\s+(.+?)(?:(?=-\\s+\\S)|\\s*$)",
    },
  };
  const adapter = getAdapter(source.type);
  const result = await adapter.fetch(patched as typeof source, { days: 400 });
  for (const e of result.events) {
    const title = String(e.title ?? "");
    if (/Hare:|Degerloch|Kiss Me/i.test(title) || /Kiss Me/.test(String(e.hares ?? ""))) {
      const d = typeof e.date === "string" ? e.date.slice(0,10) : (e.date as Date).toISOString().slice(0,10);
      console.log(`  ${d} title="${title}" hares="${e.hares ?? ""}"`);
    }
  }
  await prisma.$disconnect();
})();
