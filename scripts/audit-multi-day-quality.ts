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
  { name: "FHAC-U BAWC 2026", titleMatch: "bay area weekend campout", expectedBucket: "B.1" }, // duplicate of SFH3 umbrella
  { name: "InterScandi 2026 Oslo", titleMatch: "interscandi", expectedBucket: "A.5" }, // same-title consecutive
  { name: "BMPH3 Belgian Nash Hash 2026", titleMatch: "belgian nash hash", expectedBucket: "A.5" }, // same-title consecutive
];

// ──────────────────────────────────────────────────────────────────────────
// Regexes for bucket detection.
// ──────────────────────────────────────────────────────────────────────────
const RE_DAY_M_D_HEADER = /\*\*[A-Z][a-z]*\s+\d{1,2}\/\d{1,2}\b/; // **DAY M/D — — the canonical Hash Rego header
const RE_FRI_SAT_SUN_LABEL = /(?:^|\n|\s)(friday|saturday|sunday|fri|sat|sun)\s*:/i; // informal labels (Madison pattern)
const RE_DATE_RANGE_NUM = /\b\d{1,2}\/\d{1,2}\s*[-–]\s*\d{1,2}\/\d{1,2}\b/; // 6/19 - 6/21
const RE_KENNEL_SHORTHAND_TITLE = /^[A-Z]{2,}\d*\s*#\s*\d+\s*$/; // NAWW #391
const RE_RUN_NUMBER_SUFFIX = /[-–\s]\s*#?\s*\d+\s*$/; // " - #436" / " #436" / " - 436"
const RE_KNOWN_SOURCE_URL = /https?:\/\/(?:www\.)?(hashrego\.com|sfh3\.com|hashnyc\.com|svh3\.com|ebh3\.org|marinh3\.com)\/[^\s)>"']+/gi;

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
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
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
  // Madison pattern.
  return rows
    .filter(
      (r) =>
        r.description &&
        RE_FRI_SAT_SUN_LABEL.test(r.description) &&
        r.parentEventId === null &&
        r.endDate === null &&
        !r.isSeriesParent,
    )
    .map((r) => {
      // Show what the heuristic SHOULD have matched.
      const m = r.description!.match(RE_FRI_SAT_SUN_LABEL);
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
      const m = (where === "title" ? r.title : r.description!).match(RE_DATE_RANGE_NUM);
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
      const matches = r.description!.match(RE_DAY_NAMES_IN_DESC);
      if (!matches) return null;
      // Dedup case-insensitively (Saturday + saturday → 1).
      const distinctDays = new Set(matches.map((m) => m.toLowerCase()));
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

function bucketA5(rows: AuditRow[]): Finding[] {
  // Same kennel + similar title + consecutive dates, not linked as series.
  // Catches InterScandi (OH3 × 4 days) + BMPH3 Belgian Nash Hash (× 3 days).
  // Heuristic: group by kennelId + normalized title token-prefix; flag groups
  // of 2+ events on consecutive dates where none are series parents/children.
  // Group key = first 4 tokens of the normalized title. Per-day suffixes
  // ("Pub Crawl!" / "Hangover Trail!" / "Trail #2051") differ across days
  // but the leading event-name tokens stay stable. Example tokens:
  //   "BMPH3: Trail #2051 – Belgian Nash Hash 2026 Pub Crawl!" →
  //   first-4 → "bmph3 belgian nash hash"
  const normTitle = (t: string): string =>
    t
      .toLowerCase()
      .replace(/[#\-–—:]/g, " ")
      .replace(/\btrail\b/g, "")
      .replace(/\b\d+\b/g, "") // strip standalone run numbers + year suffixes
      .replace(/\s+/g, " ")
      .trim();

  const groupKey = (norm: string): string | null => {
    const tokens = norm.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return null;
    return tokens.slice(0, 4).join(" ");
  };

  type Group = { kennelId: string; norm: string; events: AuditRow[] };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    if (r.isSeriesParent || r.parentEventId) continue;
    const norm = normTitle(r.title);
    const prefix = groupKey(norm);
    if (!prefix || prefix.length < 8) continue; // too generic
    const key = `${r.kennel.id}::${prefix}`;
    const g = groups.get(key) ?? { kennelId: r.kennel.id, norm: prefix, events: [] };
    g.events.push(r);
    groups.set(key, g);
  }

  const findings: Finding[] = [];
  for (const g of groups.values()) {
    if (g.events.length < 2) continue;
    // Sort by date, then test for any consecutive pair (≤2-day gap allows for
    // Fri + Sat + Sun-with-recovery-on-Mon style weekends).
    const sorted = [...g.events].sort((a, b) => a.date.getTime() - b.date.getTime());
    let consecutive = false;
    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / (1000 * 60 * 60 * 24);
      if (gap >= 1 && gap <= 2) { consecutive = true; break; }
    }
    if (!consecutive) continue;
    // Cluster spans more than a week → not a weekend cluster, skip.
    const totalDays = (sorted[sorted.length - 1].date.getTime() - sorted[0].date.getTime()) / (1000 * 60 * 60 * 24);
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

function bucketB1(rows: AuditRow[]): Finding[] {
  // Cross-source duplicates of the same underlying event.
  // Two pathways to detect:
  //  (a) Two events whose `description` contains the same external URL.
  //  (b) An event's `description` contains a URL whose path (`/events/<slug>`
  //      or `/runs/<id>`) matches another event's `sourceUrl` even if the
  //      hostname differs (sfh3.com/events/133 ↔ svh3.com/events/133 — these
  //      are mirrors of the same physical event published on sibling-kennel
  //      sites). FHAC-U + SFH3 BAWC5 case.
  //
  // Normalize each URL into a (path) key — `/events/bawc-2026` or
  // `/runs/6422` — and cluster by that.
  type UrlRef = { eventId: string; rawUrl: string };
  const byPath = new Map<string, UrlRef[]>();

  const extractPath = (url: string): string | null => {
    const m = url.match(/^https?:\/\/[^/]+(\/[^?#\s)]+)/);
    if (!m) return null;
    return m[1].replace(/\/$/, "").toLowerCase();
  };

  for (const r of rows) {
    const urls = new Set<string>();
    if (r.sourceUrl) urls.add(r.sourceUrl);
    if (r.description) {
      const re = new RegExp(RE_KNOWN_SOURCE_URL.source, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(r.description)) !== null) {
        urls.add(m[0].replace(/[.,;:)]+$/, ""));
      }
    }
    for (const url of urls) {
      const p = extractPath(url);
      if (!p) continue;
      // Ignore generic non-event paths (root, /runs without an id, etc.)
      if (!/\/(events|runs)\/[\w-]+/.test(p)) continue;
      const arr = byPath.get(p) ?? [];
      arr.push({ eventId: r.id, rawUrl: url });
      byPath.set(p, arr);
    }
  }

  const findings: Finding[] = [];
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  for (const [path, refs] of byPath) {
    // Distinct event IDs only.
    const distinctIds = Array.from(new Set(refs.map((r) => r.eventId)));
    if (distinctIds.length < 2) continue;
    const evts = distinctIds.map((id) => rowsById.get(id)!).filter(Boolean);
    // Skip if the cluster is a single legitimate series — i.e. one parent
    // in the cluster and every other member is its direct child.
    const parentInCluster = evts.find((e) => e.isSeriesParent);
    if (parentInCluster) {
      const restAllChildren = evts.every(
        (e) => e.id === parentInCluster.id || e.parentEventId === parentInCluster.id,
      );
      if (restAllChildren) continue;
    }
    for (const e of evts) {
      findings.push({
        bucket: "B.1",
        eventId: e.id,
        kennel: e.kennel.shortName,
        title: e.title,
        date: fmtDate(e.date),
        sourceUrl: e.sourceUrl,
        detail: `URL path "${path}" appears across ${distinctIds.length} events; cross-source duplicate of the same physical event`,
      });
    }
  }
  return findings;
}

function bucketB2(rows: AuditRow[]): Finding[] {
  // For each series parent, find events on dates in [date, endDate] from
  // a different kennel that aren't children of this parent. Cross-kennel
  // child candidate (BAWC5 ← Marin H3 6/20).
  const findings: Finding[] = [];
  const parents = rows.filter((r) => r.isSeriesParent && r.endDate);
  // Index non-parent, non-child events by (yyyy-mm-dd) for fast lookup.
  const byDate = new Map<string, AuditRow[]>();
  for (const r of rows) {
    if (r.isSeriesParent) continue;
    if (r.parentEventId !== null) continue;
    const k = fmtDate(r.date);
    const arr = byDate.get(k) ?? [];
    arr.push(r);
    byDate.set(k, arr);
  }
  // Same-region heuristic: compare the trailing ", XX" state/country code.
  // "San Francisco, CA" and "San Jose, CA" both match on ", CA" — they're
  // both in the SF Bay Area for cross-kennel purposes. "Oslo" vs "Berlin"
  // differ on bare-city regions.
  const regionGroup = (region: string): string => {
    const m = region.match(/,\s*([A-Z]{2,3})\s*$/);
    if (m) return m[1];
    return region.toLowerCase().trim();
  };

  for (const p of parents) {
    const childKennelIds = new Set<string>();
    // Walk through dates in [start, end] inclusive.
    const start = new Date(Date.UTC(p.date.getUTCFullYear(), p.date.getUTCMonth(), p.date.getUTCDate()));
    const end = new Date(Date.UTC(p.endDate!.getUTCFullYear(), p.endDate!.getUTCMonth(), p.endDate!.getUTCDate()));
    const parentGroup = regionGroup(p.kennel.region);
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const candidates = byDate.get(fmtDate(d)) ?? [];
      for (const c of candidates) {
        // Different kennel from the umbrella.
        if (c.kennel.id === p.kennel.id) continue;
        if (childKennelIds.has(c.kennel.id)) continue;
        // Heuristic match: same region group (state/country tail).
        if (regionGroup(c.kennel.region) !== parentGroup) continue;
        childKennelIds.add(c.kennel.id);
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
  }
  return findings;
}

function bucketB3(rows: AuditRow[]): Finding[] {
  // Description contains an external URL pointing at a known source,
  // but no EventLink row matches. Provenance gap.
  const findings: Finding[] = [];
  for (const r of rows) {
    if (!r.description) continue;
    const linkUrls = new Set(r.eventLinks.map((l) => l.url));
    const re = new RegExp(RE_KNOWN_SOURCE_URL.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(r.description)) !== null) {
      const url = m[0].replace(/[.,;:)]+$/, "");
      // Skip if it's THIS event's sourceUrl (self-reference is normal).
      if (r.sourceUrl && url === r.sourceUrl) continue;
      if (linkUrls.has(url)) continue;
      findings.push({
        bucket: "B.3",
        eventId: r.id,
        kennel: r.kennel.shortName,
        title: r.title,
        date: fmtDate(r.date),
        sourceUrl: r.sourceUrl,
        detail: `description references ${url} without an EventLink row`,
      });
      break; // one finding per event is enough
    }
  }
  return findings;
}

function bucketC1(rows: AuditRow[]): Finding[] {
  // Title ends in the same 4-digit year as Event.date year.
  return rows
    .filter((r) => {
      const m = r.title.match(/\b(20\d{2})\s*$/);
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
  return rows
    .filter((r) => r.runNumber !== null && RE_RUN_NUMBER_SUFFIX.test(r.title))
    .map((r) => {
      const m = r.title.match(RE_RUN_NUMBER_SUFFIX);
      return {
        bucket: "C.2",
        eventId: r.id,
        kennel: r.kennel.shortName,
        title: r.title,
        date: fmtDate(r.date),
        sourceUrl: r.sourceUrl,
        detail: `runNumber=${r.runNumber}, suffix "${m?.[0]?.trim() ?? ""}" is redundant`,
      };
    });
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
      detail: `title === description.split('\\n')[0]`,
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
      return RE_RUN_NUMBER_SUFFIX.test(r.title);
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

function renderBucket(spec: BucketSpec, findings: Finding[]): string {
  const lines: string[] = [];
  lines.push(`### ${spec.id} — ${spec.title} (${spec.priority})`);
  lines.push("");
  lines.push(`**Count:** ${findings.length}. ${spec.hint}`);
  lines.push("");
  if (findings.length === 0) {
    lines.push("*(no findings)*");
    lines.push("");
    return lines.join("\n");
  }
  lines.push("| Event | Kennel | Date | Detail |");
  lines.push("|---|---|---|---|");
  for (const f of findings.slice(0, 10)) {
    const titleCell = escapeMd(shorten(f.title, 60));
    const detailCell = escapeMd(shorten(f.detail, 100));
    const idLink = f.sourceUrl ? `[\`${f.eventId.slice(-8)}\`](${f.sourceUrl})` : `\`${f.eventId.slice(-8)}\``;
    lines.push(`| ${titleCell} (${idLink}) | ${f.kennel} | ${f.date} | ${detailCell} |`);
  }
  if (findings.length > 10) {
    lines.push("");
    lines.push(`*…and ${findings.length - 10} more*`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderAnchors(byBucket: Map<string, Finding[]>): string {
  const lines: string[] = [];
  lines.push("## Anchor verification");
  lines.push("");
  lines.push(
    "These six events were named in the source brief and MUST appear in at least one bucket. " +
      "If any anchor is `[ ]` instead of `[x]`, the corresponding bucket query is broken.",
  );
  lines.push("");
  let allHit = true;
  for (const anchor of ANCHORS) {
    let hit = false;
    let hitBucket = "";
    for (const [bucketId, findings] of byBucket) {
      if (findings.some((f) => f.title.toLowerCase().includes(anchor.titleMatch))) {
        hit = true;
        hitBucket = bucketId;
        break;
      }
    }
    if (!hit) allHit = false;
    lines.push(`- [${hit ? "x" : " "}] **${anchor.name}** — expected in ${anchor.expectedBucket}${hit ? `, found in ${hitBucket}` : " — NOT FOUND"}`);
  }
  lines.push("");
  lines.push(allHit ? "✅ All anchors hit." : "❌ Some anchors missed — review bucket regexes.");
  lines.push("");
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Main.
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log("🔍 AUDIT — multi-day quality\n");

  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 365); // wide window — series spans + AGM-distant events

  const events = await prisma.event.findMany({
    where: {
      date: { gte: now, lte: futureDate },
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
  md.push(`# Multi-day quality audit — ${date}`);
  md.push("");
  md.push(`Generated by \`scripts/audit-multi-day-quality.ts\` against prod DB.`);
  md.push(`Total upcoming canonical events scanned: ${rows.length}`);
  md.push("");
  md.push("## Priority buckets");
  md.push("");
  // Render in the BUCKETS order (priority-grouped).
  for (const spec of BUCKETS) {
    md.push(renderBucket(spec, byBucket.get(spec.id) ?? []));
  }
  md.push(renderAnchors(byBucket));

  md.push("## Lower-impact observations (not bucketed)");
  md.push("");
  md.push("- **`/kennels/sfh3` 404** — kennel slug doesn't match user's guess (SF H3 exists in the data per BAWC5 attribution).");
  md.push("- **Empty region pages** — `/kennels/region/san-francisco-ca` shows '6 kennels' but the grid renders blank.");
  md.push("- **Blank maps in slide-out panels** — well-known venues (Mount Madonna County Park, Brown County State Park) show empty map slot. Geocoding not running or silently failing.");
  md.push("- **Search default scope is 'My Kennels'** — searches return 0 results for unsubscribed kennels with no zero-state nudge.");
  md.push("");

  md.push("---");
  md.push("");
  md.push("*Re-run this audit with `npx tsx scripts/audit-multi-day-quality.ts`. Output is overwritten for the same calendar day.*");
  md.push("");

  const outPath = path.join("docs", "audits", `multi-day-quality-${date}.md`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md.join("\n"));
  console.log(`Wrote report → ${outPath}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
