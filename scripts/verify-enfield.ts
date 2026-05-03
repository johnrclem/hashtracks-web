import "dotenv/config";
import { EnfieldHashAdapter } from "../src/adapters/html-scraper/enfield-hash";

async function main() {
  const adapter = new EnfieldHashAdapter();
  const result = await adapter.fetch({
    id: "verify-enfield",
    url: "https://enfieldhash.org/",
  } as never);

  console.log(`Events parsed: ${result.events.length}`);
  console.log(`Errors: ${(result.errors ?? []).length}`);
  console.log(`Diagnostics: ${JSON.stringify(result.diagnosticContext)}`);
  console.log("");

  for (const ev of result.events) {
    console.log(`--- ${ev.title}`);
    console.log(`   date:        ${ev.date}`);
    console.log(`   startTime:   ${ev.startTime}`);
    console.log(`   location:    ${ev.location ?? "(none)"}`);
    console.log(`   hares:       ${ev.hares ?? "(none)"}`);
    console.log(
      `   description: ${(ev.description ?? "").slice(0, 240)}${
        (ev.description ?? "").length > 240 ? "…" : ""
      }`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
