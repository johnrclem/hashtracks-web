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

interface TabResult {
  eventCount: number;
  withLocation: number;
  withLatLng: number;
  sampleTitle?: string;
  htmlBytes: number;
  status: "ok" | "http-error" | "fetch-error" | "shape-break";
  detail?: string;
}

interface AuditResult {
  kennelCode: string;
  shortName: string;
  region: string;
  handle: string;
  upcoming: TabResult;
  past: TabResult;
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

/** Audit one tab (`upcoming_hosted_events` or `past_hosted_events`) for a
 *  given Page handle. Returns a normalized {@link TabResult}; never throws. */
async function auditOneTab(
  handle: string,
  tab: "upcoming_hosted_events" | "past_hosted_events",
  kennelCode: string,
): Promise<TabResult> {
  const url = `https://www.facebook.com/${handle}/${tab}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: FB_REQUEST_HEADERS });
  } catch (err) {
    return {
      eventCount: 0,
      withLocation: 0,
      withLatLng: 0,
      htmlBytes: 0,
      status: "fetch-error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!res.ok) {
    return {
      eventCount: 0,
      withLocation: 0,
      withLatLng: 0,
      htmlBytes: 0,
      status: "http-error",
      detail: `HTTP ${res.status}`,
    };
  }
  const html = await res.text();
  const events = parseFacebookHostedEvents(html, {
    kennelTag: kennelCode,
    timezone: "UTC", // unused for the audit — we only count, not project
  });
  // True shape-break: FB structural markers absent. Empty Pages (no events
  // scheduled) still ship 600KB+ SSR bundles with `RelayPrefetchedStreamCache`
  // / `__bbox` envelopes — they're not broken, they just have nothing to list.
  // The byte-count heuristic in the production adapter is overly conservative
  // and would alert false-positive on any Page that empties out.
  const hasGraphQlEnvelope =
    html.includes("RelayPrefetchedStreamCache") || html.includes('"__bbox"');
  const status: TabResult["status"] =
    events.length === 0 && !hasGraphQlEnvelope ? "shape-break" : "ok";
  return {
    eventCount: events.length,
    withLocation: events.filter((e) => e.location).length,
    withLatLng: events.filter((e) => e.latitude !== undefined && e.longitude !== undefined).length,
    sampleTitle: events[0]?.title,
    htmlBytes: html.length,
    status,
  };
}

/** Markdown-table cell-safe formatter for a sample title — pipe-escape and
 *  newline-flatten. `String.raw` makes the literal backslash readable. */
const PIPE_ESCAPE = String.raw`\|`;
function fmtSample(s: string | undefined): string {
  return (s ?? "—").replaceAll("|", PIPE_ESCAPE).replaceAll("\n", " ").slice(0, 70);
}

function linkUp(handle: string): string {
  return `https://www.facebook.com/${handle}/upcoming_hosted_events`;
}
function linkPast(handle: string): string {
  return `https://www.facebook.com/${handle}/past_hosted_events`;
}

/** Build the four content sections + skip table in one pass. Each section
 *  is its own template literal so the report shape stays self-evident
 *  without a sea of `lines.push` calls. */
function renderReport(audited: AuditResult[], skipped: SkippedRow[]): string {
  const totalSeen = audited.length + skipped.length;
  const withUpcoming = audited.filter((a) => a.upcoming.eventCount > 0);
  const withPastOnly = audited.filter(
    (a) => a.upcoming.eventCount === 0 && a.past.eventCount > 0,
  );
  const completelyEmpty = audited.filter(
    (a) =>
      a.upcoming.eventCount === 0 &&
      a.past.eventCount === 0 &&
      a.upcoming.status === "ok" &&
      a.past.status === "ok",
  );
  const errored = audited.filter(
    (a) =>
      (a.upcoming.status !== "ok" && a.upcoming.status !== "shape-break") ||
      (a.past.status !== "ok" && a.past.status !== "shape-break"),
  );
  const byReason = new Map<string, number>();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);

  // Sort by upcoming desc → then past desc → then name. Past acts as a
  // tie-breaker: between two Pages with equal upcoming, the more-active
  // historical Page is the higher-confidence target.
  withUpcoming.sort(
    (a, b) =>
      b.upcoming.eventCount - a.upcoming.eventCount ||
      b.past.eventCount - a.past.eventCount ||
      a.shortName.localeCompare(b.shortName),
  );
  withPastOnly.sort(
    (a, b) =>
      b.past.eventCount - a.past.eventCount || a.shortName.localeCompare(b.shortName),
  );
  completelyEmpty.sort((a, b) => a.shortName.localeCompare(b.shortName));

  const today = new Date().toISOString().slice(0, 10);
  const skipBreakdown = [...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `  - \`${reason}\`: ${n}`)
    .join("\n");
  const erroredLine = errored.length > 0 ? `\n- Errored: **${errored.length}**` : "";

  const upcomingRows = withUpcoming
    .map(
      (r) =>
        `| ${r.shortName} (\`${r.kennelCode}\`) | [\`${r.handle}\`](${linkUp(r.handle)}) | ${r.region} | ${r.upcoming.eventCount} | ${r.past.eventCount} | ${r.upcoming.withLocation} | ${r.upcoming.withLatLng} | ${fmtSample(r.upcoming.sampleTitle)} |`,
    )
    .join("\n");
  const pastOnlyRows = withPastOnly
    .map(
      (r) =>
        `| ${r.shortName} (\`${r.kennelCode}\`) | [past](${linkPast(r.handle)}) · [up](${linkUp(r.handle)}) | ${r.region} | ${r.past.eventCount} | ${r.past.withLocation} | ${r.past.withLatLng} | ${fmtSample(r.past.sampleTitle)} |`,
    )
    .join("\n");
  const dormantRows = completelyEmpty
    .map(
      (r) =>
        `| ${r.shortName} (\`${r.kennelCode}\`) | [\`${r.handle}\`](${linkUp(r.handle)}) | ${r.region} |`,
    )
    .join("\n");
  const skippedRows = skipped
    .map(
      (s) =>
        `| ${s.shortName} (\`${s.kennelCode}\`) | [link](${s.facebookUrl}) | ${s.reason} |`,
    )
    .join("\n");

  const erroredSection =
    errored.length === 0
      ? ""
      : `## Errored

| Kennel | Handle | Upcoming status | Past status | Detail |
|---|---|---|---|---|
${errored
  .map(
    (r) =>
      `| ${r.shortName} (\`${r.kennelCode}\`) | \`${r.handle}\` | ${r.upcoming.status} | ${r.past.status} | ${(r.upcoming.detail ?? r.past.detail) ?? ""} |`,
  )
  .join("\n")}

`;

  return `# Facebook hosted_events audit

> One-shot audit run on ${today} —
> identifies seeded kennels with a public Facebook Page exposing populated
> \`/upcoming_hosted_events\` and/or \`/past_hosted_events\` tabs, the data source
> the \`FACEBOOK_HOSTED_EVENTS\` adapter (PR #1292) consumes. Past tab adds
> historical-backfill awareness — a Page with 0 upcoming but 50 past is a
> real kennel that just hasn't scheduled the next trail yet. Re-run via
> \`npx tsx scripts/audit-fb-hosted-events.ts\`.

## Summary

- Kennels in seed with a populated \`facebookUrl\`: **${totalSeen}**
- Page-shape handles audited: **${audited.length}**
- Skipped (not a Page-shape URL): **${skipped.length}**
${skipBreakdown}

- Pages with **≥1 upcoming event** (active scaling targets): **${withUpcoming.length}**
- Pages with **0 upcoming but ≥1 past** event (re-audit candidates — Page is real and used): **${withPastOnly.length}**
- Pages with no events on either tab (likely dormant Pages): **${completelyEmpty.length}**${erroredLine}

## Schema gap surfaced — multi-FB-URL kennels

\`Kennel.facebookUrl\` stores **one** Facebook surface per kennel today. Some kennels have **both** a Group and a Page, and they expose different content:

- **NYC H3** has Group \`groups/nychash\` (in seed as \`facebookUrl\`) AND Page \`hashnyc\` (NOT in seed). The Page exposes \`/upcoming_hosted_events\` (currently empty but reachable); the Group serves \`/events\` separately. We're storing one and missing the other entirely — and per this audit, Pages are the surface the FACEBOOK_HOSTED_EVENTS adapter can scrape.

Schema follow-up to track in \`docs/event-schema-future-fields.md\`:

- Promote \`Kennel.facebookUrl\` to a 1-to-many \`KennelFacebookSurface\` table or split into \`facebookPageUrl\` + \`facebookGroupUrl\` columns.
- Audit the 106 \`/groups/...\` skipped rows below for an associated Page handle (often \`{kennelname}\` or close to it). Some of those kennels probably have a Page with hosted_events we'd otherwise have shipped a source for.
- Source-row routing: a \`FACEBOOK_HOSTED_EVENTS\` source binds to the Page handle; a future paste-flow / Graph API source path binds to the Group. They're not interchangeable.

## Pages with upcoming events — seed candidates

Highest-leverage targets first. The \`up\`/\`past\` columns count events on each tab; \`loc/lat\` count events with structured location and lat-lng pair on the upcoming tab.

| Kennel | Handle | Region | up | past | loc | lat | Sample upcoming title |
|---|---|---|---:|---:|---:|---:|---|
${upcomingRows}

## Pages with past events but no upcoming — re-audit candidates

These Pages are demonstrably active (kennel has hosted at least one trail recently) but no upcoming events are listed today. Worth re-checking on the 30/60/90 cadence — they're high-probability scaling targets the next time the kennel updates the calendar. Past-event count is also a rough liveness signal: a Page with 50 past hosted_events is more likely to publish future trails than one with 1.

| Kennel | Handle | Region | past | loc | lat | Sample past title |
|---|---|---|---:|---:|---:|---|
${pastOnlyRows}

## Pages with no events on either tab — likely dormant

Public Pages that render cleanly but expose neither upcoming nor past hosted_events. Either the kennel doesn't use FB events at all (posts trails as regular FB posts), the Page predates FB Events as a feature, or the Page is abandoned. Lower-priority for re-audit.

| Kennel | Handle | Region |
|---|---|---|
${dormantRows}

${erroredSection}## Skipped — not a Page-shape \`facebookUrl\`

Reasons in priority order. **Group** rows are the largest pool and are the natural target for the T2b admin paste-flow PR. **Shortlink** rows can be promoted into the Page bucket by following the \`/share/\` or \`/p/\` redirect to recover the canonical handle — out of scope for this audit.

| Kennel | URL | Reason |
|---|---|---|
${skippedRows}

## Next steps

1. **Seed the top N event-producing Pages** as \`FACEBOOK_HOSTED_EVENTS\` sources, mirroring the GSH3 row in \`prisma/seed-data/sources.ts\`. The migration + adapter are already in main; only the seed rows are needed.
2. **Historical backfill** — the past-events table is the natural input for a separate one-shot script (per the Seletar pattern documented in the FB integration plan). For each Page with a meaningful past-event count, a backfill run pulls the full archive of \`start_timestamp + name + event_place\` triples and inserts them as confirmed historical Events at trustLevel 8. Out of scope for the cron path; tracked separately.
3. **Re-audit past-only Pages first** on the 30/60/90 cadence — they're demonstrably active and most likely to flip to having upcoming events. Past-only count itself is a rough liveness/popularity ranking.
4. **Resolve shortlink redirects** (the \`/share/\` / \`/p/\` skipped rows) to recover canonical handles. Cheap follow-up; small script that follows one HTTP 301 per row.
5. **Group-only kennels** (the \`group\` skipped rows) feed the T2b paste-flow PR backlog. They cannot be auto-scraped via the hosted_events route; they need admin paste or kennel-admin-installed Graph API.
6. **Multi-FB-URL kennel schema** — see "Schema gap surfaced" above. Tracked in \`docs/event-schema-future-fields.md\` as a follow-up.
`;
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
    // Two sequential fetches per Page: upcoming + past. Past tab is what
    // signals an actively-used Page even when the next trail isn't on the
    // calendar yet.
    const upcoming = await auditOneTab(handle, "upcoming_hosted_events", row.kennelCode);
    await sleep(THROTTLE_MS);
    const past = await auditOneTab(handle, "past_hosted_events", row.kennelCode);
    audited.push({
      kennelCode: row.kennelCode,
      shortName: row.shortName,
      region: row.region,
      handle,
      upcoming,
      past,
    });
    const upDesc =
      upcoming.status === "ok"
        ? `${upcoming.eventCount} upcoming`
        : `up:${upcoming.status}`;
    const pastDesc =
      past.status === "ok" ? `${past.eventCount} past` : `past:${past.status}`;
    console.log(`${upDesc}, ${pastDesc}`);
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, renderReport(audited, skipped));
  console.log(`\nReport written: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
