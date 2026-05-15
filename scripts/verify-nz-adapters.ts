/**
 * Live verification harness for the Phase 1 New Zealand adapters.
 *
 * Runs each NZ source's adapter against its production URL and prints:
 *   - event count + date range
 *   - sample event
 *   - errors / diagnostics
 *
 * Usage: npx tsx scripts/verify-nz-adapters.ts
 */

import "dotenv/config";
import { MiteriHarelineAdapter } from "@/adapters/html-scraper/miteri-hareline";
import { AucklandHussiesAdapter } from "@/adapters/html-scraper/auckland-hussies";
import { GoogleSheetsAdapter } from "@/adapters/google-sheets/adapter";
import type { Source } from "@/generated/prisma/client";

type Probe = {
  label: string;
  adapter: { fetch: (src: Source, opts?: { days?: number }) => Promise<unknown> };
  source: Partial<Source>;
  days?: number;
};

const probes: Probe[] = [
  {
    label: "Garden City H3 (Miteri / SiteOrigin)",
    adapter: new MiteriHarelineAdapter(),
    source: {
      id: "verify-gch3",
      url: "https://gardencityhash.co.nz/",
      config: { kennelTag: "garden-city-h3" },
    },
    days: 365,
  },
  {
    label: "Christchurch H3 (Miteri / Gutenberg)",
    adapter: new MiteriHarelineAdapter(),
    source: {
      id: "verify-chh3",
      url: "https://christchurchhash.net.nz/",
      config: { kennelTag: "christchurch-h3" },
    },
    days: 365,
  },
  {
    label: "Auckland Hussies (Excel-exported HTML)",
    adapter: new AucklandHussiesAdapter(),
    source: {
      id: "verify-akhussies",
      url: "https://aucklandhussies.co.nz/Run%20List.html",
      config: { kennelTag: "auckland-hussies" },
    },
    days: 365,
  },
  {
    label: "Hibiscus H3 (Google Sheets)",
    adapter: new GoogleSheetsAdapter(),
    source: {
      id: "verify-hibiscus",
      url: "https://docs.google.com/spreadsheets/d/1NcX991wiqvH0RmRzngaeFReeBKCTkJPxE1aoWIXYot8/pubhtml?gid=1&single=true",
      config: {
        sheetId: "1NcX991wiqvH0RmRzngaeFReeBKCTkJPxE1aoWIXYot8",
        csvUrl: "https://docs.google.com/spreadsheets/d/1NcX991wiqvH0RmRzngaeFReeBKCTkJPxE1aoWIXYot8/pub?output=csv&gid=1&single=true",
        skipRows: 3,
        columns: { runNumber: 0, date: 1, location: 2, hares: 3 },
        kennelTagRules: { default: "hibiscus-h3" },
        startTimeRules: { default: "18:30" },
      },
    },
    days: 365,
  },
  // STATIC_SCHEDULE sources (Tokoroa × 2, T3H3) generate occurrences from
  // RRULE — covered by static-schedule's own unit tests. Skipped here to
  // avoid pulling in `suncalc` which lives under the workspace root rather
  // than the worktree, and because they don't depend on a live network
  // fetch.
];

async function runProbe(probe: Probe): Promise<void> {
  const result = await probe.adapter.fetch(probe.source as Source, { days: probe.days ?? 180 }) as {
    events: { date: string; runNumber?: number; hares?: string; location?: string; startTime?: string; description?: string }[];
    errors: string[];
    diagnosticContext?: Record<string, unknown>;
  };

  const dates = result.events.map((e) => e.date).sort();
  console.log(`\n── ${probe.label} ──`);
  console.log(`  Events: ${result.events.length}`);
  console.log(`  Range:  ${dates[0] ?? "n/a"} → ${dates.at(-1) ?? "n/a"}`);
  console.log(`  Errors: ${result.errors.length}`);
  if (result.errors.length) {
    result.errors.slice(0, 3).forEach((e) => console.log(`    - ${e}`));
  }
  if (result.diagnosticContext) {
    console.log(`  Diag:   ${JSON.stringify(result.diagnosticContext)}`);
  }
  const sample = result.events[0];
  if (sample) {
    console.log(`  Sample: ${JSON.stringify(sample)}`);
  }
}

async function main() {
  for (const p of probes) {
    try {
      await runProbe(p);
    } catch (err) {
      console.log(`\n── ${p.label} ──`);
      console.log(`  THREW: ${err}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
