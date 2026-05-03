import "dotenv/config";
import { GlasgowH3Adapter } from "../src/adapters/html-scraper/glasgow-h3";

async function main() {
  const adapter = new GlasgowH3Adapter();
  const result = await adapter.fetch(
    {
      id: "verify-glasgow",
      url: "https://glasgowh3.co.uk/hareline.php",
    } as never,
    { days: 365 },
  );

  console.log(`Events parsed: ${result.events.length}`);
  console.log(`Errors: ${(result.errors ?? []).length}`);

  for (const ev of result.events) {
    console.log(
      `#${ev.runNumber} ${ev.date} ${ev.startTime ?? "--:--"} ` +
        `loc="${ev.location ?? "(none)"}" ` +
        `desc="${ev.description ?? ""}" ` +
        `url="${ev.locationUrl ?? ""}" ` +
        `hares="${ev.hares ?? "(none)"}"`,
    );
  }

  const r2213 = result.events.find((e) => e.runNumber === 2213);
  const r2214 = result.events.find((e) => e.runNumber === 2214);
  console.log("\n--- Acceptance ---");
  console.log(`#2213 present: ${!!r2213}, location: ${r2213?.location ?? "MISSING"}`);
  console.log(`#2214 present: ${!!r2214}, location: ${r2214?.location ?? "MISSING"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
