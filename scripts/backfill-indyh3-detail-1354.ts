/**
 * One-shot canonical backfill for #1354 — IndyScent detail fold + trail length.
 *
 * The adapter now folds the rich `/hashes/<slug>/` detail body into `description`
 * and lifts a clean mileage token into the trail-length bundle. A plain re-scrape
 * only repairs events in the forward window (which are mostly skeleton placeholders
 * with no body). Past fleshed-out events created before the fix have `description`
 * NULL, but their detail pages are still live — so this script re-fetches each
 * IndyScent/THICC canonical event's detail page through the SAME parseIndyDetail
 * and fills description / trail length where the page provides them.
 *
 * Safe & idempotent: fill-only (optimistic updateMany guard on null); a re-run
 * only re-touches events whose detail page still yields nothing (skeletons).
 * description / trailLength are NOT in the RawEvent fingerprint, so this never
 * disturbs dedup, and the merge preserves the values going forward.
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-indyh3-detail-1354.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-indyh3-detail-1354.ts --apply
 */
import { runOneShot } from "./lib/one-shot";
import { safeFetch } from "@/adapters/safe-fetch";
import { parseIndyDetail } from "@/adapters/html-scraper/indyh3";

const KENNELS = ["indyh3", "thicch3"];
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SAMPLE = 12;

void runOneShot(async ({ prisma, apply }) => {
  const events = await prisma.event.findMany({
    where: {
      sourceUrl: { contains: "/hashes/" },
      OR: [{ description: null }, { trailLengthText: null }],
      eventKennels: { some: { kennel: { kennelCode: { in: KENNELS } } } },
    },
    select: { id: true, title: true, sourceUrl: true, description: true, trailLengthText: true },
    orderBy: { date: "asc" },
  });
  console.log(`#1354 IndyScent detail backfill: ${events.length} candidate event(s) with a /hashes/ URL`);

  let descUpdated = 0;
  let trailUpdated = 0;
  let fetched = 0;
  let fetchErrors = 0;
  const samples: string[] = [];

  for (const e of events) {
    const url = e.sourceUrl as string;
    let html: string;
    try {
      const res = await safeFetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
      if (!res.ok) {
        fetchErrors++;
        continue;
      }
      html = await res.text();
      fetched++;
    } catch {
      fetchErrors++;
      continue;
    }

    const detail = parseIndyDetail(html);
    const willDesc = e.description == null && !!detail.description;
    const willTrail = e.trailLengthText == null && !!detail.trailLengthText;
    if (!willDesc && !willTrail) continue;
    if (samples.length < SAMPLE) {
      samples.push(
        `   - ${e.title}: ${willDesc ? `desc(${detail.description!.length}c) ` : ""}${willTrail ? `trail="${detail.trailLengthText}"` : ""}`,
      );
    }

    if (apply) {
      if (willDesc) {
        const r = await prisma.event.updateMany({
          where: { id: e.id, description: null },
          data: { description: detail.description },
        });
        descUpdated += r.count;
      }
      if (willTrail) {
        const r = await prisma.event.updateMany({
          where: { id: e.id, trailLengthText: null },
          data: {
            trailLengthText: detail.trailLengthText,
            trailLengthMinMiles: detail.trailLengthMinMiles ?? null,
            trailLengthMaxMiles: detail.trailLengthMaxMiles ?? null,
          },
        });
        trailUpdated += r.count;
      }
    }
  }

  console.log(`fetched ${fetched}, fetch errors ${fetchErrors}`);
  samples.forEach((s) => console.log(s));
  if (apply) console.log(`   ✏️  description updated ${descUpdated}, trail length updated ${trailUpdated}`);
  console.log(`\n${apply ? "Applied." : "Dry run complete — re-run with --apply to write."}`);
});
