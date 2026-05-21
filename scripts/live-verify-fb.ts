import "dotenv/config";
import { FacebookHostedEventsAdapter } from "../src/adapters/facebook-hosted-events/adapter";

interface TestCase {
  label: string;
  config: {
    kennelTag: string;
    pageHandle: string;
    timezone: string;
    upcomingOnly: true;
  };
}

const cases: TestCase[] = [
  {
    label: "GSH3 (canary — expects ≥1 event)",
    config: { kennelTag: "gsh3", pageHandle: "GrandStrandHashing", timezone: "America/New_York", upcomingOnly: true },
  },
  {
    label: "SWH3 (#1496 — expects 0 events, no admin notices)",
    config: { kennelTag: "swh3", pageHandle: "sirwaltersh3", timezone: "America/New_York", upcomingOnly: true },
  },
  {
    label: "HashNarwhal (#1500 — expects admin notice filtered or 0 events)",
    config: { kennelTag: "narwhal-h3", pageHandle: "HashNarwhal", timezone: "America/New_York", upcomingOnly: true },
  },
  {
    label: "rh3columbus (#1499 — expects 0 events)",
    config: { kennelTag: "renh3", pageHandle: "rh3columbus", timezone: "America/New_York", upcomingOnly: true },
  },
];

async function main() {
  const adapter = new FacebookHostedEventsAdapter();
  for (const tc of cases) {
    console.log(`\n=== ${tc.label} ===`);
    try {
      const source = { config: tc.config } as never;
      const result = await adapter.fetch(source, { days: 90 });
      console.log("events:", result.events.length);
      if (result.events.length > 0) {
        const sample = result.events[0];
        console.log("sample[0]:", JSON.stringify({
          date: sample.date,
          startTime: sample.startTime,
          title: sample.title,
          location: sample.location,
          locationStreet: sample.locationStreet,
          hares: sample.hares,
          runNumber: sample.runNumber,
          sourceUrl: sample.sourceUrl,
          descriptionFirst200: sample.description?.slice(0, 200),
        }, null, 2));
      }
      console.log("errors:", result.errors);
      console.log("parserFiltered:", result.diagnosticContext?.parserFiltered);
      console.log("htmlBytes:", result.diagnosticContext?.htmlBytes);
    } catch (err) {
      console.error("FAILED:", err instanceof Error ? err.message : String(err));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
