/**
 * One-shot canonical-Event fixes for the Bucharest H3 / Full Moon audit findings
 * (#2840–#2846) that a re-scrape cannot apply. Run it AFTER the adapter fix has
 * deployed and the Bucharest source has been scraped once: that scrape re-merges
 * every row (the adapter now emits explicit nulls), fixing locations, hares,
 * descriptions, trail types and themed titles, and creates #1141 and #1276.
 *
 * What is left, and what this script does:
 *   A. Titles. Merge keeps an existing real title when the adapter sends none, so
 *      a row whose stored title is the raw "Trail type and location" cell ("A-A",
 *      "Otopeni", "End at Anagram") and that the new parser reads as no theme is
 *      reset to the kennel's default "<Kennel> Trail #N".
 *   B. #1170: the sheet says "No trail", so the event is cancelled (admin-locked,
 *      reason recorded). The adapter now skips the row.
 *   C. Two hare lists written without delimiters (#1190, #1242), split by hand.
 *
 * Every write is guarded on the row's current value, so a re-run is a no-op, and
 * rows with an admin audit log are never touched.
 *
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/fix-bucharest-audit-wave1.ts
 *   Apply:    BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/fix-bucharest-audit-wave1.ts --apply
 */
import type { Prisma } from "@/generated/prisma/client";
import { runOneShot } from "./lib/one-shot";
import { safeFetch } from "@/adapters/safe-fetch";
import { parseCSV } from "@/adapters/google-sheets/adapter";
import { parseBucharestRow } from "@/adapters/html-scraper/bucharest-hash";
import { friendlyKennelName } from "@/pipeline/merge";
import { appendAuditLog } from "@/lib/misman/audit";

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/17NUJ3M9Th9fPi9oYkK8cLGhydW7nNq6yFMyD0x34fkQ/export?format=csv&gid=0";
const REASON = "The BHHH hareline sheet marks run #1170 as \"No trail\" (#2846).";

/** Hare cells with no delimiters, split by hand (#2844). Keyed by run; `from` is the scraped value. */
const HARE_SPLITS: Record<number, { from: string; to: string }> = {
  1190: { from: "blue Willy, Crispy Boi, Dick Supply homo", to: "Blue Willy, Crispy Boi, Dick Supply, Homo" },
  1242: { from: "Roofie Homo Blue Willy Crispi Boi Tight Ice Hole", to: "Blue Willy, Crispi Boi, Homo, Roofie, Tight Ice Hole" },
};

interface Fix {
  id: string;
  label: string;
  /** Values the row must still have; the UPDATE matches 0 rows otherwise. */
  expect: Prisma.EventWhereInput;
  data: Prisma.EventUpdateManyMutationInput;
}

const clean = (text: string | undefined) => (text ?? "").replaceAll(/\s+/g, " ").trim();

void runOneShot(async ({ prisma, apply }) => {
  const res = await safeFetch(CSV_URL, { headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" } });
  const csv = await res.text();
  if (!res.ok || !csv.startsWith("Run #")) throw new Error(`Sheet fetch failed: HTTP ${res.status}`);

  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: ["bh3-ro", "bfmh3-ro"] } },
    select: { id: true, kennelCode: true, shortName: true, fullName: true },
  });
  const kennelByCode = new Map(kennels.map((k) => [k.kennelCode, k]));
  const events = await prisma.event.findMany({
    where: { kennelId: { in: kennels.map((k) => k.id) }, isCanonical: true },
    select: {
      id: true, kennelId: true, runNumber: true, date: true, title: true, haresText: true,
      locationName: true, status: true, adminCancelledAt: true, adminAuditLog: true,
    },
  });
  const codeById = new Map(kennels.map((k) => [k.id, k.kennelCode]));
  const byRun = new Map(events.map((e) => [`${codeById.get(e.kennelId)}#${e.runNumber}`, e]));

  // Guard: the post-deploy scrape must have run (FM #3's meeting place comes from the
  // Extra column; geocoding may normalize the name, so only require that it's set).
  const fm3 = byRun.get("bfmh3-ro#3");
  if (!fm3?.locationName) {
    throw new Error(`Scrape the Bucharest source on the new adapter first (FM #3 location is ${JSON.stringify(fm3?.locationName)}).`);
  }

  const fixes: Fix[] = [];
  const review: string[] = [];

  // A. Raw trail-type / venue cells left as titles.
  for (const row of parseCSV(csv)) {
    const parsed = parseBucharestRow(row);
    if (!parsed || parsed.title !== undefined) continue;
    const code = parsed.kennelTags[0];
    const event = byRun.get(`${code}#${parsed.runNumber}`);
    const kennel = kennelByCode.get(code);
    if (!event || !kennel || event.adminAuditLog) continue;
    const defaultTitle = `${friendlyKennelName(kennel.shortName, kennel.fullName)} Trail #${parsed.runNumber}`;
    if (event.title === defaultTitle) continue;
    if (event.title !== clean(row[3])) {
      review.push(`${code} #${parsed.runNumber}: kept title ${JSON.stringify(event.title)} (cell ${JSON.stringify(clean(row[3]))})`);
      continue;
    }
    fixes.push({
      id: event.id,
      label: `${code} #${parsed.runNumber} title ${JSON.stringify(event.title)} → ${JSON.stringify(defaultTitle)}`,
      expect: { title: event.title },
      data: { title: defaultTitle },
    });
  }

  // B. #1170 "No trail".
  const noTrail = byRun.get("bh3-ro#1170");
  if (noTrail?.status === "CONFIRMED" && !noTrail.adminCancelledAt) {
    fixes.push({
      id: noTrail.id,
      label: `bh3-ro #1170 ${noTrail.date.toISOString().slice(0, 10)} → CANCELLED`,
      expect: { status: "CONFIRMED", adminCancelledAt: null },
      data: {
        status: "CANCELLED",
        adminCancelledAt: new Date(),
        adminCancelledBy: "script:fix-bucharest-audit-wave1",
        adminCancellationReason: REASON,
        adminAuditLog: appendAuditLog(noTrail.adminAuditLog, {
          action: "cancel",
          timestamp: new Date().toISOString(),
          userId: "script:fix-bucharest-audit-wave1",
          changes: { status: { old: "CONFIRMED", new: "CANCELLED" } },
          details: { reason: REASON },
        }),
      },
    });
  }

  // C. Undelimited hare lists.
  for (const [run, { from, to }] of Object.entries(HARE_SPLITS)) {
    const event = byRun.get(`bh3-ro#${run}`);
    if (!event || event.haresText === to) continue;
    if (event.haresText !== from) {
      review.push(`bh3-ro #${run}: hares are ${JSON.stringify(event.haresText)}, expected ${JSON.stringify(from)}`);
      continue;
    }
    fixes.push({ id: event.id, label: `bh3-ro #${run} hares → ${JSON.stringify(to)}`, expect: { haresText: from }, data: { haresText: to } });
  }

  let applied = 0;
  for (const fix of fixes) {
    console.log(`  ${apply ? "FIX" : "WOULD FIX"} ${fix.label}`);
    if (!apply) continue;
    const { count } = await prisma.event.updateMany({ where: { id: fix.id, ...fix.expect }, data: fix.data }); // NOSONAR S7735 — sequential by design
    if (count !== 1) console.log(`    SKIPPED: row changed since the read`);
    applied += count;
  }
  for (const line of review) console.log(`  REVIEW ${line}`);
  console.log(`\n${apply ? "Applied" : "Would apply"}: ${apply ? applied : fixes.length} | review: ${review.length} | canonical events read: ${events.length}`);
});
