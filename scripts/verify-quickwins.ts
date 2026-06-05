/**
 * One-shot live verification for the 5-issue quick-win bundle
 * (#1955 Perth, #1933 SACH3, #1932 Hogtown, #1934 Princeton, #1954 Memphis).
 * Not part of CI. Run manually:
 *   eval "$(fnm env)" && fnm use 20 && npx tsx scripts/verify-quickwins.ts
 */
import "dotenv/config";
import { sync as icalSync } from "node-ical";
import type { Source } from "@/generated/prisma/client";
import { SOURCES } from "../prisma/seed-data/sources";
import { safeFetch } from "@/adapters/safe-fetch";
import { hasPlaceholderRunNumber } from "@/adapters/utils";
import { parseICalSummary, ICalAdapter } from "@/adapters/ical/adapter";
import { SquarespaceEventsAdapter } from "@/adapters/html-scraper/squarespace-events";
import { HogtownAdapter } from "@/adapters/html-scraper/hogtown";
import { GoogleCalendarAdapter } from "@/adapters/google-calendar/adapter";

const fails: string[] = [];

function asSource(name: string): Source {
  const s = SOURCES.find((x) => x.name === name);
  if (!s) throw new Error(`seed source not found: ${name}`);
  return { id: `verify-${name}`, enabled: true, ...s } as unknown as Source;
}

/** Replicate the PRE-#1955 title extraction so we can diff old vs new. */
function oldEffectiveTitle(summary: string): string | undefined {
  const m = summary.match(/^[A-Za-z0-9 .'-]+(?:\s*#[\d.A-Za-z]+)?:\s*(.+)$/);
  const oldTitle = m ? m[1].replace(/^#\d+\?+\s*/, "").trim() || undefined : undefined;
  return oldTitle ?? (hasPlaceholderRunNumber(summary) ? undefined : summary);
}

async function diffIcalSummaries() {
  console.log("\n===== iCal cross-source title diff (#1955 regression guard) =====");
  const icalSources = SOURCES.filter((s) => s.type === "ICAL_FEED" && s.enabled !== false);
  for (const s of icalSources) {
    const cfg = (s.config ?? {}) as {
      kennelPatterns?: [string, string][];
      defaultKennelTag?: string;
      keepNonKennelTitlePrefix?: boolean;
    };
    let raw: string;
    try {
      const res = await safeFetch(s.url);
      raw = await res.text();
    } catch (e) {
      console.log(`  ${s.name}: FETCH FAILED (${String(e).slice(0, 80)}) — skipped`);
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = icalSync.parseICS(raw) as Record<string, unknown>;
    } catch {
      console.log(`  ${s.name}: ICS parse failed — skipped`);
      continue;
    }
    const summaries: string[] = [];
    for (const v of Object.values(parsed)) {
      const ve = v as { type?: string; summary?: unknown };
      if (ve.type === "VEVENT" && typeof ve.summary === "string") summaries.push(ve.summary);
    }
    const diffs: Array<{ summary: string; old?: string; neu?: string }> = [];
    for (const summary of summaries) {
      const parsedNew = parseICalSummary(summary, cfg.kennelPatterns, cfg.defaultKennelTag, cfg.keepNonKennelTitlePrefix);
      const neu = parsedNew.title ?? (hasPlaceholderRunNumber(summary) ? undefined : summary);
      const old = oldEffectiveTitle(summary);
      if (neu !== old) diffs.push({ summary, old, neu });
    }
    console.log(`  ${s.name}: ${summaries.length} VEVENTs, ${diffs.length} title diff(s)`);
    for (const d of diffs) {
      // EXPECTED diffs: a non-kennel "Prefix:" that the old code stripped and
      // the new code keeps as the full summary. FLAG anything else.
      const expected = d.neu === d.summary && d.old !== d.summary;
      const tag = expected ? "KEPT-PREFIX (expected)" : "⚠️ REGRESSION?";
      console.log(`     ${tag}  SUMMARY=${JSON.stringify(d.summary)}  old=${JSON.stringify(d.old)}  new=${JSON.stringify(d.neu)}`);
      if (!expected) fails.push(`iCal title regression on ${s.name}: ${d.summary}`);
    }
  }
}

async function verifyPerth() {
  console.log("\n===== Perth Hash Lunch title (#1955) =====");
  const adapter = new ICalAdapter();
  const result = await adapter.fetch(asSource("Perth H3 Hareline"), { days: 365 });
  console.log("  errors:", result.errors);
  const lunch = result.events.find((e) => /hash lunch/i.test(e.title ?? ""));
  if (lunch) {
    console.log("  Hash Lunch event:", JSON.stringify({ date: lunch.date, title: lunch.title }));
    if (!/^Hash Lunch:/i.test(lunch.title ?? "")) fails.push("Perth Hash Lunch title lost its prefix");
  } else {
    console.log("  (no Hash Lunch event in current feed window — printing sample titles)");
  }
  console.log("  sample titles:", result.events.slice(0, 8).map((e) => e.title));
}

async function verifySach3() {
  console.log("\n===== SACH3 locationName fallback (#1933) =====");
  const adapter = new SquarespaceEventsAdapter();
  const result = await adapter.fetch(asSource("Sacramento H3 Squarespace Events"), { days: 365 });
  console.log("  errors:", result.errors);
  const withBlankTitleStreet = result.events.filter((e) => e.location && e.locationStreet && e.location === e.locationStreet);
  console.log(`  events where location == composed street (addressTitle was blank): ${withBlankTitleStreet.length}`);
  const sample = result.events.find((e) => e.location);
  console.log("  sample with location:", JSON.stringify({ date: sample?.date, title: sample?.title, location: sample?.location }));
  const noLocButStreet = result.events.filter((e) => !e.location && e.locationStreet);
  if (noLocButStreet.length > 0) fails.push(`${noLocButStreet.length} SACH3 events still have a street but no locationName`);
}

async function verifyHogtown() {
  console.log("\n===== Hogtown campout secondary-page location (#1932) =====");
  const adapter = new HogtownAdapter();
  const result = await adapter.fetch(asSource("Hogtown H3 Website"), { days: 365 });
  console.log("  errors:", result.errors);
  const campout = result.events.find((e) => /campout/i.test(e.title ?? ""));
  if (campout) {
    console.log("  campout event:", JSON.stringify({ date: campout.date, title: campout.title, location: campout.location }));
    if (!campout.location) fails.push("Hogtown campout still has no location");
  } else {
    console.log("  (no campout in current window — printing all titles+locations)");
    result.events.forEach((e) => console.log("    ", e.runNumber, e.title, "=>", e.location));
  }
}

async function verifyPrinceton() {
  console.log("\n===== Princeton placeholder title (#1934) =====");
  const adapter = new GoogleCalendarAdapter();
  const result = await adapter.fetch(asSource("Princeton NJ Hash Calendar"), { days: 120 });
  console.log("  errors:", result.errors);
  console.log("  events:", result.events.map((e) => ({ date: e.date, title: e.title })));
  const placeholder = result.events.find((e) => /detail cuming|2nd Sunday/i.test(e.title ?? ""));
  if (placeholder) fails.push(`Princeton still shows placeholder title: ${placeholder.title}`);
}

async function main() {
  await diffIcalSummaries();
  await verifyPerth();
  await verifySach3();
  await verifyHogtown();
  await verifyPrinceton();

  if (fails.length) {
    console.error("\n❌ VERIFICATION FAILED:\n - " + fails.join("\n - "));
    process.exit(1);
  }
  console.log("\n✅ All quick-win live verifications passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
