/**
 * Live verification for the cycle-12 pre-cycle bundle (#1690 / #1689 /
 * #1677 / #1705). Calls each affected adapter against its real upstream
 * URL and reports:
 *
 *   - Houston PII summary "Sleep Study - Christine Kuhl Remote visit"
 *     should NOT appear in the emitted events.
 *   - Moooouston bare-SUMMARY events ("Moooouston H3 -" / "Moooouston H3")
 *     should now carry title === "Moooouston H3 Trail".
 *   - Mosquito bare-SUMMARY events ("Mosquito H3") should now carry
 *     title === "Mosquito H3 Trail".
 *   - Meetup against the deleted `meetup-group-cwrnpwpc` group should
 *     return gracefully (empty events + non-fatal error).
 *
 * Usage: `npx tsx scripts/live-verify-cycle12-bundle.ts`
 */
import "dotenv/config";
import { GoogleCalendarAdapter } from "@/adapters/google-calendar/adapter";
import { MeetupAdapter } from "@/adapters/meetup/adapter";
import type { Source } from "@/generated/prisma/client";
import type { RawEventData } from "@/adapters/types";

/** Quote a sample event title for diagnostic logging. Defined at module
 *  scope so the call sites don't nest a template literal inside another
 *  template literal (Sonar S4624). */
function formatTitleSample(event: RawEventData): string {
  return `"${event.title ?? ""}"`;
}

/** `diagnosticContext` is typed as `Record<string, unknown>`. Coerce the
 *  numeric counters into actual numbers for safe stringification — Sonar
 *  S6551 otherwise flags the `unknown ?? 0` shape because non-numeric
 *  payloads would print as `[object Object]`. */
function readNumericCounter(
  ctx: Record<string, unknown> | undefined,
  key: string,
): number {
  const value = ctx?.[key];
  return typeof value === "number" ? value : 0;
}

function buildHoustonSource(): Source {
  return {
    id: "houston-live-verify",
    name: "Houston Hash Calendar (live verify)",
    url: "hashvoice@gmail.com",
    type: "GOOGLE_CALENDAR",
    enabled: true,
    trustLevel: 7,
    scrapeFreq: "every_6h",
    scrapeDays: 365,
    config: {
      kennelPatterns: [
        ["Brass Monkey H3|Brass Monkey", "bmh3-tx"],
        [String.raw`GALVESTON H3|Galveston H3|GH3\s*#|#\d+\s*Galveston`, "galh3"],
        ["Space City H3|Space City Hash|SCH3", "space-city-h3"],
        ["Moooouston H3|Moooo?uston", "moooouston-h3"],
        ["Mosquito H3|Mosquito", "mosquito-h3"],
      ],
      defaultKennelTag: "h4-tx",
      skipPatterns: ["^VOICE:", "^Platterpuss"],
      defaultTitles: {
        "moooouston-h3": "Moooouston H3 Trail",
        "space-city-h3": "Space City H3 Trail",
        "mosquito-h3": "Mosquito H3 Trail",
      },
      staleTitleAliases: {
        "space-city-h3": ["Space City Hash"],
      },
      preferDefaultTitleOverDescription: true,
    },
  } as unknown as Source;
}

function buildNarwhalSource(): Source {
  return {
    id: "narwhal-live-verify",
    name: "Narwhal H3 Meetup (live verify)",
    url: "https://www.meetup.com/meetup-group-cwrnpwpc/",
    type: "MEETUP",
    enabled: true,
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 180,
    config: {
      groupUrlname: "meetup-group-cwrnpwpc",
      kennelTag: "narwhal-h3",
    },
  } as unknown as Source;
}

async function verifyHouston() {
  console.log("\n=== Houston Hash Calendar (#1690 PII + #1677 + #1705) ===");
  const adapter = new GoogleCalendarAdapter();
  const result = await adapter.fetch(buildHoustonSource(), { days: 365 });

  console.log(`events: ${result.events.length}, errors: ${result.errors.length}`);
  if (result.errors.length) console.log(`  errors: ${result.errors.slice(0, 3).join(" | ")}`);

  // #1690 — verify the PII title is NOT present
  const piiHit = result.events.find((e) => /sleep study/i.test(e.title ?? ""));
  if (piiHit) {
    console.error(`  FAIL #1690: PII event leaked — title="${piiHit.title}" date=${piiHit.date}`);
  } else {
    console.log("  OK  #1690: no 'Sleep Study' event in emitted RawEvents");
  }

  // #1677 — verify Moooouston bare-SUMMARY → "Moooouston H3 Trail"
  const moo = result.events.filter((e) => e.kennelTags.includes("moooouston-h3"));
  const mooLeaks = moo.filter((e) => /^\*+update\*+$/i.test(e.title ?? ""));
  console.log(`  Moooouston events: ${moo.length}, leaky **update** titles: ${mooLeaks.length}`);
  if (mooLeaks.length) {
    console.error(`  FAIL #1677: leak persists — sample: ${JSON.stringify(mooLeaks[0])}`);
  } else {
    console.log("  OK  #1677: no leaked '**update**' titles for moooouston-h3");
  }
  // Sample a few moooouston titles
  const mooSamples = moo.slice(0, 3).map(formatTitleSample).join(", ");
  console.log(`  Sample moooouston titles: ${mooSamples}`);

  // #1705 — verify Mosquito bare-SUMMARY → "Mosquito H3 Trail"
  const mos = result.events.filter((e) => e.kennelTags.includes("mosquito-h3"));
  const mosLeaks = mos.filter((e) => /broke back ranger/i.test(e.title ?? ""));
  console.log(`  Mosquito events: ${mos.length}, leaky 'Broke back ranger' titles: ${mosLeaks.length}`);
  if (mosLeaks.length) {
    console.error(`  FAIL #1705: leak persists — sample: ${JSON.stringify(mosLeaks[0])}`);
  } else {
    console.log("  OK  #1705: no leaked 'Broke back ranger' titles for mosquito-h3");
  }
  const mosSamples = mos.slice(0, 3).map(formatTitleSample).join(", ");
  console.log(`  Sample mosquito titles: ${mosSamples}`);

  // Explicit fix verification — bare-SUMMARY events should now resolve
  // to the configured `Moooouston H3 Trail` / `Mosquito H3 Trail` default.
  const mooDefaults = moo.filter((e) => e.title === "Moooouston H3 Trail");
  const mosDefaults = mos.filter((e) => e.title === "Mosquito H3 Trail");
  console.log(`  bare-SUMMARY Moooouston events resolving to default: ${mooDefaults.length}/${moo.length}`);
  console.log(`  bare-SUMMARY Mosquito events resolving to default: ${mosDefaults.length}/${mos.length}`);
}

async function verifyNarwhal() {
  console.log("\n=== Narwhal Meetup (#1689) ===");
  const adapter = new MeetupAdapter();
  const result = await adapter.fetch(buildNarwhalSource(), { days: 180 });
  console.log(`events: ${result.events.length}, errors: ${result.errors.length}`);
  console.log(`  adminNoticeSkipped: ${readNumericCounter(result.diagnosticContext, "adminNoticeSkipped")}`);
  console.log(`  cancelledSkipped: ${readNumericCounter(result.diagnosticContext, "cancelledSkipped")}`);
  const adminHit = result.events.find((e) => /moving to a new website/i.test(e.title ?? ""));
  if (adminHit) {
    console.error(`  FAIL #1689: admin notice leaked — title="${adminHit.title}"`);
  } else {
    console.log("  OK  #1689: no 'Moving to a new website' event in emitted RawEvents (group may be deleted; graceful empty is fine)");
  }
  if (result.errors.length) console.log(`  errors: ${result.errors.slice(0, 3).join(" | ")}`);
}

async function main() {
  await verifyHouston();
  await verifyNarwhal();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
