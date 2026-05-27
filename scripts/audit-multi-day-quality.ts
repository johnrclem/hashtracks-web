/**
 * Audit — multi-day series detection + title quality (refs #1560).
 *
 * Reads upcoming canonical Events from prod, buckets them by description
 * shape + title pattern, and writes a categorized markdown report to
 *   docs/audits/multi-day-quality-{YYYY-MM-DD}.md
 *
 * Read-only — only uses prisma.event.findMany. No writes anywhere.
 *
 * Usage:
 *   npx tsx scripts/audit-multi-day-quality.ts
 *
 * Output is overwritten on same-day re-runs. Future-date runs produce new
 * report files (one per calendar day).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { detectVenueWeekendEndDate } from "../src/pipeline/venue-weekend";
import {
  normalizeTitleForCluster,
  clusterGroupKey,
  isConsecutiveCluster,
} from "../src/pipeline/same-title-cluster";
import fs from "node:fs";
import path from "node:path";

// ──────────────────────────────────────────────────────────────────────────
// Anchor events — these MUST surface in at least one bucket. Used as a
// load-bearing self-check at the bottom of the report.
//
// Identified by case-insensitive title substring match because IDs change
// across re-scrapes and the report is meant to be re-runnable as the data
// evolves. The user's brief named these explicitly.
// ──────────────────────────────────────────────────────────────────────────
const ANCHORS: ReadonlyArray<{ name: string; titleMatch: string; expectedBucket: string }> = [
  { name: "MadisonH3 Token Run Campout 2026", titleMatch: "token run campout", expectedBucket: "A.2" },
  { name: "BAWC5 SFH3", titleMatch: "bawc", expectedBucket: "A.4" }, // catches via child-count mismatch
  // Stable B.1 cross-source anchor. FHAC-U BAWC 2026 was the original
  // motivating example but got CANCELLED in prod between PR G and PR
  // #1741, so the audit filter excluded it (CodeRabbit PR #1741 found
  // a stale anchor self-check failure). BigHumpH3 Bungle 2026 surfaces
  // the same cross-source pattern: Hash Rego event slug also referenced
  // by an HTML scraper. Stable across re-scrapes.
  { name: "BigHumpH3 Bungle 2026", titleMatch: "bighumph3 bungle 2026", expectedBucket: "B.1" },
  { name: "InterScandi 2026 Oslo", titleMatch: "interscandi", expectedBucket: "A.5" }, // same-title consecutive
  { name: "BMPH3 Belgian Nash Hash 2026", titleMatch: "belgian nash hash", expectedBucket: "A.5" }, // same-title consecutive
];

// ──────────────────────────────────────────────────────────────────────────
// Regexes for bucket detection.
// ──────────────────────────────────────────────────────────────────────────
const RE_DAY_M_D_HEADER = /\*\*[A-Z][a-z]*\s+\d{1,2}\/\d{1,2}\b/; // **DAY M/D — — the canonical Hash Rego header
// Cheap pre-filter for A.2 — the expensive part (≥2 distinct weekdays +
// trigger-word gate) is the imported `detectVenueWeekendEndDate` itself.
const RE_FRI_SAT_SUN_LABEL = /(?:^|\n|\s)(friday|saturday|sunday|fri|sat|sun)\s*:/i; // informal labels (Madison pattern)
const RE_DATE_RANGE_NUM = /\b\d{1,2}\/\d{1,2}\s*[-–]\s*\d{1,2}\/\d{1,2}\b/; // 6/19 - 6/21
const RE_KENNEL_SHORTHAND_TITLE = /^[A-Z]{2,}\d*\s*#\s*\d+\s*$/; // NAWW #391
// Sonar S5852 flags any `\s*…$` or `\d+$` anchored regex as ReDoS-shaped
// even when linear. Procedural detection keeps the same semantics (was
// `/[-–\s]\s*#?\s*\d+\s*$/`) without tripping the heuristic.
//
// Original regex shape: `[-–\s]` (one boundary char), then `\s*#?\s*\d+\s*$`.
// Equivalent walk right-to-left: digits → optional whitespace → optional `#`
// → optional whitespace → boundary char in `{-, –, whitespace}`. If we
// consumed any whitespace during the strips, the boundary is implicitly
// satisfied (one of those whitespaces IS the `[-–\s]` the regex anchored on).
function isAsciiDigit(ch: string): boolean {
  const code = ch.codePointAt(0);
  return code !== undefined && code >= 0x30 && code <= 0x39;
}
function getRunNumberSuffix(title: string): string | null {
  const t = title.trimEnd();
  let digitsStart = t.length;
  while (digitsStart > 0 && isAsciiDigit(t[digitsStart - 1])) digitsStart--;
  if (digitsStart === t.length) return null;
  let pos = digitsStart;
  let consumedWhitespace = false;
  while (pos > 0 && (t[pos - 1] === " " || t[pos - 1] === "\t")) {
    pos--;
    consumedWhitespace = true;
  }
  if (pos > 0 && t[pos - 1] === "#") pos--;
  while (pos > 0 && (t[pos - 1] === " " || t[pos - 1] === "\t")) {
    pos--;
    consumedWhitespace = true;
  }
  if (pos === 0) return null;
  const boundary = t[pos - 1];
  if (boundary === "-" || boundary === "–") {
    return title.slice(pos - 1).trim();
  }
  if (consumedWhitespace) {
    // The boundary char IS one of the whitespaces we already stripped;
    // anchor the suffix at the current `pos`.
    return title.slice(pos).trim();
  }
  return null;
}
// URL extraction is split into a simple bounded-quantifier regex + a
// Set-based host filter so Sonar S5852 (ReDoS) stays clean. A single
// alternation `(hashrego\.com|...)` inside the regex tripped the ReDoS
// heuristic even with a bounded path quantifier; matching ANY URL and
// post-filtering by hostname removes the alternation entirely and is
// straightforwardly linear.
const KNOWN_SOURCE_HOSTS = new Set([
  "hashrego.com",
  "sfh3.com",
  "hashnyc.com",
  "svh3.com",
  "ebh3.org",
  "marinh3.com",
]);
const RE_ANY_URL = /https?:\/\/[^\s/)>"']{1,200}\/[^\s)>"']{1,500}/gi;

// Strip trailing chars from a string procedurally (Sonar S5852 avoids the
// `[chars]+$` regex shape on hot string-trimming paths).
function stripTrailingChars(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1])) end--;
  return s.slice(0, end);
}

function extractKnownSourceUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(RE_ANY_URL)) {
    const url = stripTrailingChars(m[0], ".,;:)");
    const hostMatch = /^https?:\/\/(?:www\.)?([^/]{1,200})\//.exec(url);
    if (!hostMatch) continue;
    if (KNOWN_SOURCE_HOSTS.has(hostMatch[1].toLowerCase())) {
      out.push(url);
    }
  }
  return out;
}

// Day-name labels found in description, used to count "apparent day count"
// for A.4 (parent.childEvents.length vs description's day mentions).
const RE_DAY_NAMES_IN_DESC = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi;

interface AuditRow {
  id: string;
  title: string;
  date: Date;
  runNumber: number | null;
  parentEventId: string | null;
  isSeriesParent: boolean;
  endDate: Date | null;
  description: string | null;
  sourceUrl: string | null;
  kennel: { id: string; shortName: string; kennelCode: string; region: string };
  eventLinks: Array<{ url: string }>;
  childEvents: Array<{ id: string }>;
}

interface Finding {
  bucket: string;
  eventId: string;
  kennel: string;
  title: string;
  date: string;
  sourceUrl: string | null;
  detail: string;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shorten(s: string | null, n = 80): string {
  if (!s) return "—";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function escapeMd(s: string): string {
  return s.replaceAll("|", String.raw`\|`).replaceAll("\n", " ");
}

// ──────────────────────────────────────────────────────────────────────────
// Bucket functions. Each returns Finding[] for one bucket.
// ──────────────────────────────────────────────────────────────────────────

function bucketA1(rows: AuditRow[]): Finding[] {
  // Events with **DAY M/D — header, currently isSeriesParent=true.
  // Validation anchor — counts the success case.
  return rows
    .filter((r) => r.isSeriesParent && r.description && RE_DAY_M_D_HEADER.test(r.description))
    .map((r) => ({
      bucket: "A.1",
      eventId: r.id,
      kennel: r.kennel.shortName,
      title: r.title,
      date: fmtDate(r.date),
      sourceUrl: r.sourceUrl,
      detail: `children: ${r.childEvents.length}`,
    }));
}

function bucketA2(rows: AuditRow[]): Finding[] {
  // Friday:/Saturday:/Sunday: informal labels, NOT recognized as series.
  // Madison pattern. Calls the production heuristic directly so the audit's
  // count reflects exactly the events the heuristic would act on — same
  // trigger-word gate AND ≥2 distinct weekday names (PR #1741 CodeRabbit
  // review). Pre-filter on the cheap label regex first so we don't pay
  // detectVenueWeekendEndDate's cost on every row.
  return rows
    .filter(
      (r) =>
        r.description &&
        RE_FRI_SAT_SUN_LABEL.test(r.description) &&
        r.parentEventId === null &&
        r.endDate === null &&
        !r.isSeriesParent &&
        detectVenueWeekendEndDate(
          r.description,
          r.title,
          fmtDate(r.date),
        ) !== null,
    )
    .map((r) => {
      // Show what the heuristic SHOULD have matched.
      const m = RE_FRI_SAT_SUN_LABEL.exec(r.description!);
      return {
        bucket: "A.2",
        eventId: r.id,
        kennel: r.kennel.shortName,
        title: r.title,
        date: fmtDate(r.date),
        sourceUrl: r.sourceUrl,
        detail: `description has "${m?.[0]?.trim() ?? "Fri/Sat/Sun:"}" label`,
      };
    });
}

function bucketA3(rows: AuditRow[]): Finding[] {
  // Date range in title or description, no series structure.
  // InterScandi / BMPH3 / BOGS pattern.
  return rows
    .filter((r) => {
      if (r.parentEventId !== null) return false;
      if (r.endDate !== null) return false;
      if (r.isSeriesParent) return false;
      const titleHasRange = RE_DATE_RANGE_NUM.test(r.title);
      const descHasRange = r.description ? RE_DATE_RANGE_NUM.test(r.description) : false;
      return titleHasRange || descHasRange;
    })
    .map((r) => {
      const where = RE_DATE_RANGE_NUM.test(r.title) ? "title" : "description";
      const m = RE_DATE_RANGE_NUM.exec(where === "title" ? r.title : r.description!);
      return {
        bucket: "A.3",
        eventId: r.id,
        kennel: r.kennel.shortName,
        title: r.title,
        date: fmtDate(r.date),
        sourceUrl: r.sourceUrl,
        detail: `${where} contains range "${m?.[0] ?? "?"}"`,
      };
    });
}

function bucketA4(rows: AuditRow[]): Finding[] {
  // isSeriesParent=true with child count != apparent description day count.
  // Madison-style "we recognized it but missed days" case.
  return rows
    .filter((r) => r.isSeriesParent && r.description)
    .map((r) => {
      // Dedup case-insensitively (Saturday + saturday → 1).
      const distinctDays = new Set<string>();
      for (const m of r.description!.matchAll(RE_DAY_NAMES_IN_DESC)) {
        distinctDays.add(m[0].toLowerCase());
      }
      if (distinctDays.size === 0) return null;
      const dayCount = distinctDays.size;
      const childCount = r.childEvents.length;
      // Allow off-by-one (parent itself might count). Flag if differs by ≥2.
      if (Math.abs(dayCount - childCount) < 2) return null;
      return {
        bucket: "A.4",
        eventId: r.id,
        kennel: r.kennel.shortName,
        title: r.title,
        date: fmtDate(r.date),
        sourceUrl: r.sourceUrl,
        detail: `${dayCount} distinct day-names in description, ${childCount} children linked`,
      };
    })
    .filter((f): f is Finding => f !== null);
}

// A.5 cluster grouping shares its helpers with the production linker
// (`src/pipeline/same-title-cluster.ts`, PR I). Same normalization + group
// key + consecutive-cluster check so the audit count always reflects what
// the linker would act on. To check membership we need to call the same
// helpers per-row, so wrap the imports in adapter-style helpers below.

interface A5Group { kennelId: string; norm: string; events: AuditRow[]; }

function clusterA5Groups(rows: AuditRow[]): Map<string, A5Group> {
  const groups = new Map<string, A5Group>();
  for (const r of rows) {
    if (r.isSeriesParent || r.parentEventId) continue;
    const norm = normalizeTitleForCluster(r.title);
    const prefix = clusterGroupKey(norm);
    if (!prefix) continue;
    const key = `${r.kennel.id}::${prefix}`;
    const g = groups.get(key) ?? { kennelId: r.kennel.id, norm: prefix, events: [] };
    g.events.push(r);
    groups.set(key, g);
  }
  return groups;
}

// `isConsecutiveCluster` in the linker takes `{ date: Date }[]` — our
// `AuditRow` is a structural superset so we can pass it directly.
const DAY_MS_A5 = 1000 * 60 * 60 * 24;

function bucketA5(rows: AuditRow[]): Finding[] {
  // Same kennel + similar title + consecutive dates, not linked as series.
  // Catches InterScandi (OH3 × 4 days) + BMPH3 Belgian Nash Hash (× 3 days).
  const DAY_MS = 1000 * 60 * 60 * 24;
  const findings: Finding[] = [];
  for (const g of clusterA5Groups(rows).values()) {
    if (g.events.length < 2) continue;
    const sorted = [...g.events].sort((a, b) => a.date.getTime() - b.date.getTime());
    if (!isConsecutiveCluster(sorted)) continue;
    // Cluster spans more than a week → not a weekend cluster, skip.
    const totalDays = (sorted.at(-1)!.date.getTime() - sorted[0].date.getTime()) / DAY_MS;
    if (totalDays > 7) continue;
    for (const e of sorted) {
      findings.push({
        bucket: "A.5",
        eventId: e.id,
        kennel: e.kennel.shortName,
        title: e.title,
        date: fmtDate(e.date),
        sourceUrl: e.sourceUrl,
        detail: `${sorted.length} consecutive-day events with similar title "${g.norm}" on this kennel; should be linked as series`,
      });
    }
  }
  return findings;
}

function extractB1Path(url: string): string | null {
  // Pull /events/<slug> or /runs/<id> path off any host (sfh3.com,
  // svh3.com, hashrego.com, etc.) so siblings cluster despite different hosts.
  // Bounded quantifiers (Sonar S5852) — host ≤200 chars, path ≤500 chars.
  const m = /^https?:\/\/[^/]{1,200}(\/[^?#\s)]{1,500})/.exec(url);
  if (!m) return null;
  const path = stripTrailingChars(m[1], "/").toLowerCase();
  // Ignore generic non-event paths (root, /runs without an id, etc.)
  if (!/\/(events|runs)\/[\w-]+/.test(path)) return null;
  return path;
}

function collectKnownSourceUrls(r: AuditRow): Set<string> {
  const urls = new Set<string>();
  if (r.sourceUrl) urls.add(r.sourceUrl);
  // Include EventLink rows too (Codex PR #1718 review): normalized provenance
  // links stored on the event are exactly the data B.1 should be clustering.
  // Missing them undercounts cross-source duplicates whose collision is the
  // EventLink, not the description text.
  for (const link of r.eventLinks) {
    urls.add(link.url);
  }
  if (r.description) {
    for (const url of extractKnownSourceUrls(r.description)) {
      urls.add(url);
    }
  }
  return urls;
}

function clusterByB1Path(rows: AuditRow[]): Map<string, Set<string>> {
  // path → set of eventIds referencing that path
  const byPath = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const url of collectKnownSourceUrls(r)) {
      const p = extractB1Path(url);
      if (!p) continue;
      const set = byPath.get(p) ?? new Set<string>();
      set.add(r.id);
      byPath.set(p, set);
    }
  }
  return byPath;
}

function isLegitParentChildCluster(evts: AuditRow[]): boolean {
  const parent = evts.find((e) => e.isSeriesParent);
  if (!parent) return false;
  return evts.every(
    (e) => e.id === parent.id || e.parentEventId === parent.id,
  );
}

function bucketB1(rows: AuditRow[]): Finding[] {
  // Cross-source duplicates of the same underlying event. Two pathways:
  //  (a) Two events whose `description` contains the same external URL.
  //  (b) An event's `description` contains a URL whose path (`/events/<slug>`
  //      or `/runs/<id>`) matches another event's `sourceUrl` even if the
  //      hostname differs (sfh3.com/events/133 ↔ svh3.com/events/133 —
  //      mirrors of the same physical event on sibling-kennel sites).
  //      FHAC-U + SFH3 BAWC5 case.
  const findings: Finding[] = [];
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  for (const [path, idSet] of clusterByB1Path(rows)) {
    if (idSet.size < 2) continue;
    const evts = Array.from(idSet).map((id) => rowsById.get(id)!).filter(Boolean);
    if (isLegitParentChildCluster(evts)) continue;
    for (const e of evts) {
      findings.push({
        bucket: "B.1",
        eventId: e.id,
        kennel: e.kennel.shortName,
        title: e.title,
        date: fmtDate(e.date),
        sourceUrl: e.sourceUrl,
        detail: `URL path "${path}" appears across ${idSet.size} events; cross-source duplicate of the same physical event`,
      });
    }
  }
  return findings;
}

// Same-region heuristic for B.2: trailing ", XX" state/country code.
// "San Francisco, CA" and "San Jose, CA" both match on "CA" — both in the
// SF Bay Area. "Oslo" vs "Berlin" differ on bare-city regions.
function regionGroup(region: string): string {
  const m = /,\s*([A-Z]{2,3})\s*$/.exec(region);
  if (m) return m[1];
  return region.toLowerCase().trim();
}

function indexNonParentByDate(rows: AuditRow[]): Map<string, AuditRow[]> {
  const byDate = new Map<string, AuditRow[]>();
  for (const r of rows) {
    if (r.isSeriesParent || r.parentEventId !== null) continue;
    const k = fmtDate(r.date);
    const arr = byDate.get(k) ?? [];
    arr.push(r);
    byDate.set(k, arr);
  }
  return byDate;
}

function* iterateUmbrellaDates(parent: AuditRow): Iterable<string> {
  const start = new Date(Date.UTC(parent.date.getUTCFullYear(), parent.date.getUTCMonth(), parent.date.getUTCDate()));
  const end = new Date(Date.UTC(parent.endDate!.getUTCFullYear(), parent.endDate!.getUTCMonth(), parent.endDate!.getUTCDate()));
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield fmtDate(d);
  }
}

function findB2Candidates(parent: AuditRow, byDate: Map<string, AuditRow[]>): AuditRow[] {
  const parentGroup = regionGroup(parent.kennel.region);
  const seenKennels = new Set<string>();
  const out: AuditRow[] = [];
  for (const dateKey of iterateUmbrellaDates(parent)) {
    const candidates = byDate.get(dateKey) ?? [];
    for (const c of candidates) {
      if (c.kennel.id === parent.kennel.id) continue;
      if (seenKennels.has(c.kennel.id)) continue;
      if (regionGroup(c.kennel.region) !== parentGroup) continue;
      seenKennels.add(c.kennel.id);
      out.push(c);
    }
  }
  return out;
}

function bucketB2(rows: AuditRow[]): Finding[] {
  // For each series parent, find events on dates in [date, endDate] from a
  // different kennel that aren't children of this parent. Cross-kennel
  // child candidate (e.g. BAWC5 ← MarinH3/SVH3/FHAC-U on Bay Area trails).
  const findings: Finding[] = [];
  const parents = rows.filter((r) => r.isSeriesParent && r.endDate);
  const byDate = indexNonParentByDate(rows);
  for (const p of parents) {
    for (const c of findB2Candidates(p, byDate)) {
      findings.push({
        bucket: "B.2",
        eventId: c.id,
        kennel: c.kennel.shortName,
        title: c.title,
        date: fmtDate(c.date),
        sourceUrl: c.sourceUrl,
        detail: `same date+region as umbrella "${shorten(p.title, 40)}" (${p.kennel.shortName}, id=${p.id}); not linked as child`,
      });
    }
  }
  return findings;
}

function firstUnlinkedKnownUrl(r: AuditRow): string | null {
  if (!r.description) return null;
  const linkUrls = new Set(r.eventLinks.map((l) => l.url));
  for (const url of extractKnownSourceUrls(r.description)) {
    if (r.sourceUrl && url === r.sourceUrl) continue;
    if (linkUrls.has(url)) continue;
    return url;
  }
  return null;
}

function bucketB3(rows: AuditRow[]): Finding[] {
  // Description contains an external URL pointing at a known source,
  // but no EventLink row matches. Provenance gap.
  const findings: Finding[] = [];
  for (const r of rows) {
    const url = firstUnlinkedKnownUrl(r);
    if (!url) continue;
    findings.push({
      bucket: "B.3",
      eventId: r.id,
      kennel: r.kennel.shortName,
      title: r.title,
      date: fmtDate(r.date),
      sourceUrl: r.sourceUrl,
      detail: `description references ${url} without an EventLink row`,
    });
  }
  return findings;
}

function bucketC1(rows: AuditRow[]): Finding[] {
  // Title ends in the same 4-digit year as Event.date year.
  return rows
    .filter((r) => {
      const m = /\b(20\d{2})\s*$/.exec(r.title);
      if (!m) return false;
      return Number(m[1]) === r.date.getUTCFullYear();
    })
    .map((r) => ({
      bucket: "C.1",
      eventId: r.id,
      kennel: r.kennel.shortName,
      title: r.title,
      date: fmtDate(r.date),
      sourceUrl: r.sourceUrl,
      detail: `year suffix matches Event.date year (${r.date.getUTCFullYear()})`,
    }));
}

function bucketC2(rows: AuditRow[]): Finding[] {
  // Title has run-number-looking suffix when runNumber is non-null.
  // " - #436" / " - 436" / " #436" patterns.
  //
  // Require the suffix digits to match `r.runNumber` (Codex PR #1718 review).
  // Without this, a title ending in a year ("Strawberry Moon 2026") or any
  // other numeric suffix would get flagged even though it's not duplicating
  // the run-number field. C.1 already catches the year-suffix case separately.
  const findings: Finding[] = [];
  for (const r of rows) {
    if (r.runNumber === null) continue;
    const suffix = getRunNumberSuffix(r.title);
    if (suffix === null) continue;
    // Walk over the suffix collecting only the digit run. `suffix` ends in
    // the run-number digits per getRunNumberSuffix's contract.
    let i = suffix.length;
    while (i > 0 && isAsciiDigit(suffix[i - 1])) i--;
    const digits = suffix.slice(i);
    if (digits.length === 0 || Number(digits) !== r.runNumber) continue;
    findings.push({
      bucket: "C.2",
      eventId: r.id,
      kennel: r.kennel.shortName,
      title: r.title,
      date: fmtDate(r.date),
      sourceUrl: r.sourceUrl,
      detail: `runNumber=${r.runNumber}, suffix "${suffix}" is redundant`,
    });
  }
  return findings;
}

function bucketC3(rows: AuditRow[]): Finding[] {
  return rows
    .filter((r) => r.title.length > 80)
    .map((r) => ({
      bucket: "C.3",
      eventId: r.id,
      kennel: r.kennel.shortName,
      title: r.title,
      date: fmtDate(r.date),
      sourceUrl: r.sourceUrl,
      detail: `${r.title.length} chars`,
    }));
}

function bucketC4(rows: AuditRow[]): Finding[] {
  // Title equals first line of description (long-description-as-title).
  return rows
    .filter((r) => {
      if (!r.description) return false;
      const firstLine = r.description.split("\n")[0].trim();
      if (firstLine.length < 30) return false; // avoid trivially short matches
      return firstLine === r.title.trim();
    })
    .map((r) => ({
      bucket: "C.4",
      eventId: r.id,
      kennel: r.kennel.shortName,
      title: r.title,
      date: fmtDate(r.date),
      sourceUrl: r.sourceUrl,
      detail: String.raw`title === description.split('\n')[0]`,
    }));
}

function bucketC5(rows: AuditRow[]): Finding[] {
  // Kennel-prefixed shorthand title (NAWW #391).
  return rows
    .filter((r) => RE_KENNEL_SHORTHAND_TITLE.test(r.title))
    .map((r) => ({
      bucket: "C.5",
      eventId: r.id,
      kennel: r.kennel.shortName,
      title: r.title,
      date: fmtDate(r.date),
      sourceUrl: r.sourceUrl,
      detail: `title is just kennel + run number`,
    }));
}

function bucketC6(rows: AuditRow[]): Finding[] {
  // Title contains kennel shortName AND a run-number suffix (Buck Moon - GGFM #436).
  return rows
    .filter((r) => {
      if (r.runNumber === null) return false;
      const short = r.kennel.shortName;
      if (!short || short.length < 2) return false;
      if (!r.title.includes(short)) return false;
      return getRunNumberSuffix(r.title) !== null;
    })
    .map((r) => ({
      bucket: "C.6",
      eventId: r.id,
      kennel: r.kennel.shortName,
      title: r.title,
      date: fmtDate(r.date),
      sourceUrl: r.sourceUrl,
      detail: `kennel "${r.kennel.shortName}" + run-number suffix both in title`,
    }));
}

// ──────────────────────────────────────────────────────────────────────────
// Markdown rendering.
// ──────────────────────────────────────────────────────────────────────────

interface BucketSpec {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2";
  hint: string;
}

const BUCKETS: ReadonlyArray<BucketSpec> = [
  { id: "A.2", title: "`Friday:/Saturday:/Sunday:` informal labels not recognized as series", priority: "P0", hint: "Campout heuristic from PR #1637 should fire on these." },
  { id: "A.5", title: "Same-title consecutive-day events on same kennel, not linked as series", priority: "P0", hint: "Non-English / non-Hash-Rego multi-day patterns (InterScandi 4×OH3, BMPH3 3×Belgian Nash Hash). Parser needs same-kennel + consecutive-date clustering." },
  { id: "B.1", title: "Cross-source URL collisions (events sharing an `/events/<slug>` or `/runs/<id>` path)", priority: "P0", hint: "FHAC-U + SFH3 BAWC pattern. The two events represent the same physical event via mirrored URLs across sibling-kennel sites. Needs umbrella dedup by URL path." },
  { id: "A.3", title: "Date range in title/description, no series structure", priority: "P0", hint: "Numeric `M/D – M/D` patterns not in series form. Less common than A.5." },
  { id: "B.2", title: "Sibling-kennel events on umbrella dates, not linked as children", priority: "P1", hint: "Cross-kennel children (e.g. MarinH3/SVH3/FHAC-U trails within BAWC5 weekend). Region match is by state-code suffix." },
  { id: "A.4", title: "Series parent with child count ≠ apparent description day count", priority: "P1", hint: "Partially-recognized series. Parser caught some days but not all." },
  { id: "C.6", title: "Title contains kennel name AND run-number suffix", priority: "P1", hint: "Redundant — kennel pill + run-number field already render these." },
  { id: "C.4", title: "Title equals first line of description (long-description-as-title)", priority: "P1", hint: "Title-extraction broken; pulling description blob verbatim." },
  { id: "C.5", title: "Title is just `KENNEL #NNN` shorthand", priority: "P1", hint: "Source-side data quality — title missing a descriptive name." },
  { id: "B.3", title: "Description references external known-source URL without EventLink row", priority: "P2", hint: "Provenance gap. Lower-impact unless paired with B.1." },
  { id: "C.1", title: "Title ends in year matching Event.date year (redundant year suffix)", priority: "P2", hint: "Card already shows the date." },
  { id: "C.2", title: "Title has run-number suffix when runNumber field is set", priority: "P2", hint: "Redundant with the run-number field on the card." },
  { id: "C.3", title: "Title longer than 80 characters", priority: "P2", hint: "Truncates with ellipsis on the card." },
  { id: "A.1", title: "`**DAY M/D` headers parsed correctly as series (validation anchor)", priority: "P2", hint: "Success case — confirms the parser is working on the canonical pattern." },
];

function renderEventIdLink(eventId: string, sourceUrl: string | null): string {
  const idCode = `\`${eventId.slice(-8)}\``;
  return sourceUrl ? `[${idCode}](${sourceUrl})` : idCode;
}

function renderBucket(spec: BucketSpec, findings: Finding[]): string {
  const lines: string[] = [
    `### ${spec.id} — ${spec.title} (${spec.priority})`,
    "",
    `**Count:** ${findings.length}. ${spec.hint}`,
    "",
  ];
  if (findings.length === 0) {
    lines.push("*(no findings)*", "");
    return lines.join("\n");
  }
  lines.push("| Event | Kennel | Date | Detail |", "|---|---|---|---|");
  for (const f of findings.slice(0, 10)) {
    const titleCell = escapeMd(shorten(f.title, 60));
    const detailCell = escapeMd(shorten(f.detail, 100));
    const idLink = renderEventIdLink(f.eventId, f.sourceUrl);
    lines.push(`| ${titleCell} (${idLink}) | ${f.kennel} | ${f.date} | ${detailCell} |`);
  }
  if (findings.length > 10) {
    lines.push("", `*…and ${findings.length - 10} more*`);
  }
  lines.push("");
  return lines.join("\n");
}

function titleMatchInBucket(
  bucket: Finding[] | undefined,
  anchorMatch: string,
): boolean {
  return (bucket ?? []).some((f) => f.title.toLowerCase().includes(anchorMatch));
}

function findAnchorBucketAnywhere(
  anchorMatch: string,
  byBucket: Map<string, Finding[]>,
  excludeBucketId?: string,
): string | null {
  for (const [bucketId, findings] of byBucket) {
    if (excludeBucketId && bucketId === excludeBucketId) continue;
    if (titleMatchInBucket(findings, anchorMatch)) return bucketId;
  }
  return null;
}

function renderAnchorTail(
  inExpected: boolean,
  expectedBucket: string,
  foundElsewhere: string | null,
): string {
  if (inExpected) return `, found in ${expectedBucket}`;
  if (foundElsewhere) return `, found in ${foundElsewhere} (wrong bucket)`;
  return " — NOT FOUND";
}

function renderAnchors(byBucket: Map<string, Finding[]>): string {
  // Anchor verification enforces `expectedBucket` — a match in any other bucket
  // is reported as "wrong bucket" rather than counted as a hit (CodeRabbit
  // PR #1718 review). Without this, broad title substrings (e.g. "bawc")
  // could mask a broken bucket query by falling into the wrong category.
  const intro = `These ${ANCHORS.length} events were named in the source brief and MUST appear in at least one bucket. ` +
    "If any anchor is `[ ]` instead of `[x]`, the corresponding bucket query is broken.";
  const lines: string[] = ["## Anchor verification", "", intro, ""];

  let allHit = true;
  for (const anchor of ANCHORS) {
    const inExpected = titleMatchInBucket(byBucket.get(anchor.expectedBucket), anchor.titleMatch);
    const foundElsewhere = inExpected
      ? null
      : findAnchorBucketAnywhere(anchor.titleMatch, byBucket, anchor.expectedBucket);
    if (!inExpected) allHit = false;
    const mark = inExpected ? "x" : " ";
    const tail = renderAnchorTail(inExpected, anchor.expectedBucket, foundElsewhere);
    lines.push(`- [${mark}] **${anchor.name}** — expected in ${anchor.expectedBucket}${tail}`);
  }
  lines.push(
    "",
    allHit ? "✅ All anchors hit." : "❌ Some anchors missed — review bucket regexes.",
    "",
  );
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Main.
// ──────────────────────────────────────────────────────────────────────────

async function runAudit(prisma: PrismaClient): Promise<void> {
  console.log("🔍 AUDIT — multi-day quality\n");

  // Day-boundary filtering (CodeRabbit PR #1718 review): events store dates
  // as UTC noon, so a precise `gte: now` filter could exclude same-day rows
  // depending on the wall-clock minute. Floor to start-of-today-UTC for
  // deterministic same-day reruns.
  const today = new Date();
  const startOfTodayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const futureDate = new Date(startOfTodayUtc);
  futureDate.setUTCDate(futureDate.getUTCDate() + 365); // wide window — series spans + AGM-distant events

  const events = await prisma.event.findMany({
    where: {
      date: { gte: startOfTodayUtc, lte: futureDate },
      status: { not: "CANCELLED" },
      isCanonical: true,
      kennel: { isHidden: false },
    },
    select: {
      id: true,
      title: true,
      date: true,
      runNumber: true,
      parentEventId: true,
      isSeriesParent: true,
      endDate: true,
      description: true,
      sourceUrl: true,
      kennel: { select: { id: true, shortName: true, kennelCode: true, region: true } },
      eventLinks: { select: { url: true } },
      childEvents: { select: { id: true } },
    },
  });

  console.log(`Scanned ${events.length} upcoming canonical events.\n`);

  const rows: AuditRow[] = events.map((e) => ({
    id: e.id,
    title: e.title ?? "(no title)",
    date: e.date,
    runNumber: e.runNumber,
    parentEventId: e.parentEventId,
    isSeriesParent: e.isSeriesParent ?? false,
    endDate: e.endDate,
    description: e.description,
    sourceUrl: e.sourceUrl,
    kennel: e.kennel,
    eventLinks: e.eventLinks,
    childEvents: e.childEvents,
  }));

  // Run all buckets.
  const results: Array<[string, Finding[]]> = [
    ["A.1", bucketA1(rows)],
    ["A.2", bucketA2(rows)],
    ["A.3", bucketA3(rows)],
    ["A.4", bucketA4(rows)],
    ["A.5", bucketA5(rows)],
    ["B.1", bucketB1(rows)],
    ["B.2", bucketB2(rows)],
    ["B.3", bucketB3(rows)],
    ["C.1", bucketC1(rows)],
    ["C.2", bucketC2(rows)],
    ["C.3", bucketC3(rows)],
    ["C.4", bucketC4(rows)],
    ["C.5", bucketC5(rows)],
    ["C.6", bucketC6(rows)],
  ];
  const byBucket = new Map(results);

  // Summary line for stdout.
  console.log("Bucket counts:");
  for (const [bucketId, findings] of results) {
    console.log(`  ${bucketId}: ${findings.length}`);
  }
  console.log("");

  // Markdown.
  const date = fmtDate(new Date());
  const md: string[] = [];
  md.push(
    `# Multi-day quality audit — ${date}`,
    "",
    `Generated by \`scripts/audit-multi-day-quality.ts\` against prod DB.`,
    `Total upcoming canonical events scanned: ${rows.length}`,
    "",
    "## Priority buckets",
    "",
  );
  // Render in the BUCKETS order (priority-grouped).
  for (const spec of BUCKETS) {
    md.push(renderBucket(spec, byBucket.get(spec.id) ?? []));
  }
  md.push(
    renderAnchors(byBucket),
    "## Lower-impact observations (not bucketed)",
    "",
    "- **`/kennels/sfh3` 404** — kennel slug doesn't match user's guess (SF H3 exists in the data per BAWC5 attribution).",
    "- **Empty region pages** — `/kennels/region/san-francisco-ca` shows '6 kennels' but the grid renders blank.",
    "- **Blank maps in slide-out panels** — well-known venues (Mount Madonna County Park, Brown County State Park) show empty map slot. Geocoding not running or silently failing.",
    "- **Search default scope is 'My Kennels'** — searches return 0 results for unsubscribed kennels with no zero-state nudge.",
    "",
    "---",
    "",
    "*Re-run this audit with `npx tsx scripts/audit-multi-day-quality.ts`. Output is overwritten for the same calendar day.*",
    "",
  );

  const outPath = path.join("docs", "audits", `multi-day-quality-${date}.md`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md.join("\n"));
  console.log(`Wrote report → ${outPath}`);
}

async function main(): Promise<void> {
  // try/finally ensures Prisma + pool are always closed even if the audit
  // throws partway through (CodeRabbit PR #1718 review). Without this, an
  // exception during findMany or markdown serialization leaves DB handles open.
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    await runAudit(prisma);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
