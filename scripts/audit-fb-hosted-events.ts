/**
 * One-shot audit: which seeded kennels have a public Facebook Page with
 * a populated `/upcoming_hosted_events` tab we could scrape via the
 * FACEBOOK_HOSTED_EVENTS adapter (PR #1292)?
 *
 * Strategy
 * --------
 * 1. Read every kennel from `prisma/seed-data/kennels.ts` (source of truth —
 *    avoids needing prod DB access).
 * 2. Filter to Page-shape `facebookUrl` values; skip `/groups/`, `/people/`,
 *    `/profile.php`, `/events/`, `/pages/`, `/p/`, `/share/`. Groups need
 *    the paste-flow (T2b); short-link shapes need redirect resolution
 *    (out of scope for this audit).
 * 3. For each Page handle, fetch `/upcoming_hosted_events` with the same
 *    headers the adapter uses (Sec-Fetch triplet required to avoid 400).
 * 4. Parse with the production parser. Tally event count, whether
 *    `event_place.contextual_name` and lat/lng are populated, sample title.
 * 5. 250ms courtesy throttle between fetches — well below FB's anonymous
 *    rate limits.
 * 6. Output a sorted markdown table to
 *    `docs/kennel-research/facebook-hosted-events-audit.md`, ranked by
 *    event count (most events first → highest-leverage seed targets).
 *
 * Run with: `npx tsx scripts/audit-fb-hosted-events.ts`
 *
 * The FACEBOOK_HOSTED_EVENTS adapter at `src/adapters/facebook-hosted-events/`
 * is the canonical reference for header pinning, parser surface, and
 * shape-break heuristics — this script intentionally re-uses its parser.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { parseFacebookHostedEvents } from "@/adapters/facebook-hosted-events/parser";
import { FB_RESERVED_FIRST_SEGMENTS } from "@/adapters/facebook-hosted-events/constants";

const SEED_PATH = join(process.cwd(), "prisma/seed-data/kennels.ts");
const OUT_PATH = join(process.cwd(), "docs/kennel-research/facebook-hosted-events-audit.md");

const FB_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

const THROTTLE_MS = 250;
const RESERVED_SET = new Set<string>(
  FB_RESERVED_FIRST_SEGMENTS.map((s) => s.toLowerCase()),
);
// Short-link / share shapes that need redirect-following to recover the
// canonical Page handle. Out of scope for this audit; flagged separately.
const SHORTLINK_SEGMENTS = new Set(["share", "p"]);

interface KennelRow {
  kennelCode: string;
  shortName: string;
  region: string;
  facebookUrl: string;
}

interface AuditResult {
  kennelCode: string;
  shortName: string;
  region: string;
  handle: string;
  eventCount: number;
  withLocation: number;
  withLatLng: number;
  withDescription: number;
  sampleTitle?: string;
  htmlBytes: number;
  status: "ok" | "http-error" | "fetch-error" | "shape-break";
  detail?: string;
}

interface SkippedRow {
  kennelCode: string;
  shortName: string;
  facebookUrl: string;
  reason: "group" | "people" | "profile" | "shortlink" | "events-page" | "reserved" | "no-handle";
}

/**
 * Pull every `{ kennelCode, shortName, region, facebookUrl }` from the seed
 * file via a tolerant single-line regex. Kennel object literals span 1–4
 * lines in the source, so we re-scan with `String.matchAll` over chunks
 * separated by `},` boundaries — same shape as the seed file's object
 * literal layout. Falls back gracefully on rows missing `facebookUrl`.
 */
function readSeedKennels(): KennelRow[] {
  const src = readFileSync(SEED_PATH, "utf-8");
  // Split at object-literal boundaries — the seed uses `{ kennelCode: ..., ... },`.
  const blocks = src.split(/},/);
  const out: KennelRow[] = [];
  for (const block of blocks) {
    const code = /kennelCode:\s*"([^"]+)"/.exec(block)?.[1];
    if (!code) continue;
    const fbMatch = /facebookUrl:\s*"([^"]+)"/.exec(block);
    if (!fbMatch) continue;
    const shortName = /shortName:\s*"([^"]+)"/.exec(block)?.[1] ?? code;
    const region = /region:\s*"([^"]+)"/.exec(block)?.[1] ?? "";
    out.push({ kennelCode: code, shortName, region, facebookUrl: fbMatch[1] });
  }
  return out;
}

/**
 * Classify a `facebookUrl` into either a Page handle to audit or a skip
 * reason. Mirrors `extractFirstPathSegment` + `FB_RESERVED_FIRST_SEGMENTS`
 * but adds short-link awareness so we don't mis-classify those as Pages.
 */
function classify(url: string): { handle: string } | { skip: SkippedRow["reason"] } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { skip: "no-handle" };
  }
  if (!/(?:^|\.)facebook\.com$/i.test(parsed.hostname)) return { skip: "no-handle" };
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return { skip: "no-handle" };
  const first = parts[0].toLowerCase();
  if (first === "groups") return { skip: "group" };
  if (first === "people") return { skip: "people" };
  if (first === "profile.php") return { skip: "profile" };
  if (first === "events") return { skip: "events-page" };
  if (SHORTLINK_SEGMENTS.has(first)) return { skip: "shortlink" };
  if (RESERVED_SET.has(first)) return { skip: "reserved" };
  return { handle: parts[0] };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function auditOne(row: KennelRow, handle: string): Promise<AuditResult> {
  const url = `https://www.facebook.com/${handle}/upcoming_hosted_events`;
  const base = {
    kennelCode: row.kennelCode,
    shortName: row.shortName,
    region: row.region,
    handle,
  };
  let res: Response;
  try {
    res = await fetch(url, { headers: FB_REQUEST_HEADERS });
  } catch (err) {
    return {
      ...base,
      eventCount: 0,
      withLocation: 0,
      withLatLng: 0,
      withDescription: 0,
      htmlBytes: 0,
      status: "fetch-error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!res.ok) {
    return {
      ...base,
      eventCount: 0,
      withLocation: 0,
      withLatLng: 0,
      withDescription: 0,
      htmlBytes: 0,
      status: "http-error",
      detail: `HTTP ${res.status}`,
    };
  }
  const html = await res.text();
  const events = parseFacebookHostedEvents(html, {
    kennelTag: row.kennelCode,
    timezone: "UTC", // unused for the audit — we only count, not project
  });
  // True shape-break: FB structural markers absent. Empty Pages (no events
  // scheduled) still ship 600KB+ SSR bundles with `RelayPrefetchedStreamCache`
  // / `__bbox` envelopes — they're not broken, they just have nothing to list.
  // The byte-count heuristic in the production adapter is overly conservative
  // and would alert false-positive on any Page that empties out (#audit-script).
  const hasGraphQlEnvelope =
    html.includes("RelayPrefetchedStreamCache") || html.includes('"__bbox"');
  const status: AuditResult["status"] =
    events.length === 0 && !hasGraphQlEnvelope ? "shape-break" : "ok";
  return {
    ...base,
    eventCount: events.length,
    withLocation: events.filter((e) => e.location).length,
    withLatLng: events.filter((e) => e.latitude !== undefined && e.longitude !== undefined).length,
    withDescription: events.filter((e) => e.description).length,
    sampleTitle: events[0]?.title,
    htmlBytes: html.length,
    status,
  };
}

function renderReport(audited: AuditResult[], skipped: SkippedRow[]): string {
  const totalSeen = audited.length + skipped.length;
  const withEvents = audited.filter((a) => a.eventCount > 0);
  const empty = audited.filter((a) => a.eventCount === 0 && a.status === "ok");
  const errored = audited.filter((a) => a.status !== "ok");
  const byReason = new Map<string, number>();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);

  // Sort by event count descending, then by name.
  withEvents.sort(
    (a, b) => b.eventCount - a.eventCount || a.shortName.localeCompare(b.shortName),
  );
  empty.sort((a, b) => a.shortName.localeCompare(b.shortName));

  const lines: string[] = [];
  lines.push("# Facebook hosted_events audit");
  lines.push("");
  lines.push(`> One-shot audit run on ${new Date().toISOString().slice(0, 10)} —`);
  lines.push(
    "> identifies seeded kennels with a public Facebook Page exposing a populated",
  );
  lines.push(
    "> `/upcoming_hosted_events` tab, the data source the `FACEBOOK_HOSTED_EVENTS`",
  );
  lines.push(
    "> adapter (PR #1292) consumes. Re-run via `npx tsx scripts/audit-fb-hosted-events.ts`.",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Kennels in seed with a populated \`facebookUrl\`: **${totalSeen}**`);
  lines.push(`- Page-shape handles audited: **${audited.length}**`);
  lines.push(`- Skipped (not a Page-shape URL): **${skipped.length}**`);
  for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  - \`${reason}\`: ${n}`);
  }
  lines.push("");
  lines.push(
    `- Pages with **≥1 upcoming event** (scaling targets): **${withEvents.length}**`,
  );
  lines.push(`- Pages reachable but empty (no upcoming events): **${empty.length}**`);
  lines.push(`- Errored / shape-broken: **${errored.length}**`);
  lines.push("");

  lines.push("## Pages with upcoming events — seed candidates");
  lines.push("");
  lines.push(
    "Highest-leverage targets first. `loc/lat/desc` columns count events with structured location, lat-lng pair, and post-body description respectively (max = total events).",
  );
  lines.push("");
  lines.push("| Kennel | Handle | Region | Events | loc | lat | desc | Sample title |");
  lines.push("|---|---|---|---:|---:|---:|---:|---|");
  for (const r of withEvents) {
    const sample = (r.sampleTitle ?? "—")
      .replaceAll("|", "\\|")
      .replaceAll("\n", " ")
      .slice(0, 80);
    lines.push(
      `| ${r.shortName} (\`${r.kennelCode}\`) | [\`${r.handle}\`](https://www.facebook.com/${r.handle}/upcoming_hosted_events) | ${r.region} | ${r.eventCount} | ${r.withLocation} | ${r.withLatLng} | ${r.withDescription} | ${sample} |`,
    );
  }
  lines.push("");

  lines.push("## Pages reachable but no upcoming events");
  lines.push("");
  lines.push(
    "These are public Pages (no login wall, page rendered) but no events on the hosted_events tab right now. Worth re-auditing periodically — kennels schedule trails in bursts.",
  );
  lines.push("");
  lines.push("| Kennel | Handle | Region | HTML bytes |");
  lines.push("|---|---|---|---:|");
  for (const r of empty) {
    lines.push(
      `| ${r.shortName} (\`${r.kennelCode}\`) | [\`${r.handle}\`](https://www.facebook.com/${r.handle}/upcoming_hosted_events) | ${r.region} | ${r.htmlBytes.toLocaleString()} |`,
    );
  }
  lines.push("");

  if (errored.length > 0) {
    lines.push("## Errored / shape-broken");
    lines.push("");
    lines.push("| Kennel | Handle | Status | Detail |");
    lines.push("|---|---|---|---|");
    for (const r of errored) {
      lines.push(
        `| ${r.shortName} (\`${r.kennelCode}\`) | \`${r.handle}\` | ${r.status} | ${r.detail ?? ""} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Skipped — not a Page-shape `facebookUrl`");
  lines.push("");
  lines.push(
    "Reasons in priority order. **Group** rows are the largest pool and are the natural target for the T2b admin paste-flow PR. **Shortlink** rows can be promoted into the Page bucket by following the `/share/` or `/p/` redirect to recover the canonical handle — out of scope for this audit.",
  );
  lines.push("");
  lines.push("| Kennel | URL | Reason |");
  lines.push("|---|---|---|");
  for (const s of skipped) {
    lines.push(
      `| ${s.shortName} (\`${s.kennelCode}\`) | [link](${s.facebookUrl}) | ${s.reason} |`,
    );
  }
  lines.push("");

  lines.push("## Next steps");
  lines.push("");
  lines.push(
    "1. **Seed the top N event-producing Pages** as `FACEBOOK_HOSTED_EVENTS` sources, mirroring the GSH3 row in `prisma/seed-data/sources.ts`. The migration + adapter are already in main; only the seed rows are needed.",
  );
  lines.push(
    "2. **Re-audit empty Pages** in 30/60/90 days — kennels publish trails in bursts. A Page that's empty today may have 5 upcoming next month.",
  );
  lines.push(
    "3. **Resolve shortlink redirects** (the `/share/` / `/p/` skipped rows) to recover canonical handles. Cheap follow-up; small script that follows one HTTP 301 per row.",
  );
  lines.push(
    "4. **Group-only kennels** (the `group` skipped rows) feed the T2b paste-flow PR backlog. They cannot be auto-scraped; they need admin paste or kennel-admin-installed Graph API.",
  );
  lines.push("");

  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const kennels = readSeedKennels();
  console.log(`Read ${kennels.length} kennels with facebookUrl from seed.`);

  const audited: AuditResult[] = [];
  const skipped: SkippedRow[] = [];
  const targets: { row: KennelRow; handle: string }[] = [];

  for (const row of kennels) {
    const c = classify(row.facebookUrl);
    if ("skip" in c) {
      skipped.push({
        kennelCode: row.kennelCode,
        shortName: row.shortName,
        facebookUrl: row.facebookUrl,
        reason: c.skip,
      });
    } else {
      targets.push({ row, handle: c.handle });
    }
  }

  console.log(`Classifying: ${targets.length} Page-shape, ${skipped.length} skipped.`);
  console.log(`Auditing ${targets.length} Pages with ${THROTTLE_MS}ms throttle...`);

  for (let i = 0; i < targets.length; i++) {
    const { row, handle } = targets[i];
    if (i > 0) await sleep(THROTTLE_MS);
    process.stdout.write(`  [${i + 1}/${targets.length}] ${row.shortName} (${handle})... `);
    const result = await auditOne(row, handle);
    audited.push(result);
    console.log(
      result.status === "ok"
        ? `${result.eventCount} events`
        : `${result.status}: ${result.detail ?? ""}`,
    );
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, renderReport(audited, skipped));
  console.log(`\nReport written: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
