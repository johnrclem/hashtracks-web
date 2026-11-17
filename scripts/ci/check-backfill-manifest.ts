/**
 * The `backfill-manifest` CI job (docs/onboarding-backfill-automation-design.md 6.2).
 *
 *   git diff --name-status --no-renames HEAD^1 HEAD | npx tsx scripts/ci/check-backfill-manifest.ts --stdin
 *
 * For every backfill manifest a PR adds or changes, it recomputes the manifest
 * from the committed archive and checks it. CI has no prod access, so the
 * checks that need prod (sources in prod, overlap, earlier runs) are the
 * server's. The numbers the owner approves are written to the job's check-run
 * summary ($GITHUB_STEP_SUMMARY), derived here from the committed files, not
 * from a PR body.
 *
 * This file is a guard path (G15): a PR that changes it can't be applied
 * automatically.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { RawEventData } from "@/adapters/types";
import { SOURCES } from "../../prisma/seed-data/sources";
import { addDays, daysBetween } from "@/lib/backfill/canonical";
import { checkDeclaredFields, compareManifest, parseArchive, type BackfillManifest } from "@/lib/backfill/manifest";
import { scanArchiveForPii, summarizePiiHits } from "@/lib/backfill/pii";
import { checkRowProvenance, SUPPORTED_ORIGIN_TYPES, websiteHosts } from "@/lib/backfill/provenance";
import { checkMigrationForBackfill, findSourceInserts } from "@/lib/backfill/migration-check";
import { checkRowDates, checkRowRouting, checkRowShape, checkRunOrder, checkSeriesMarkerKeys, checkSize, medianRunInterval } from "@/lib/backfill/guards";
import type { SourceType } from "@/generated/prisma/client";

const HISTORY_RE = /^scripts\/data\/[a-z0-9-]+-history[a-z0-9-]*\.(manifest\.)?json$/;
const MIGRATION_RE = /^prisma\/migrations\/[^/]+\/migration\.sql$/;

interface Changed {
  status: string;
  file: string;
}

interface SeedSource {
  name: string;
  url: string;
  type: SourceType;
  config?: unknown;
  enabled?: boolean;
  archiveOnly?: boolean;
  kennelCodes?: string[];
}

function parseNameStatus(out: string): Changed[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split("\t");
      return { status: status[0], file };
    });
}

/** A GCal event link whose event id is a repeating instance (`_YYYYMMDD`…), as kennel-evidence reads it. */
function isInstanceEid(url: string | undefined): boolean {
  const eid = url && /[?&]eid=([A-Za-z0-9_-]+)/.exec(url)?.[1];
  if (!eid) return false;
  const decoded = Buffer.from(eid, "base64url").toString("utf8");
  return /^[^ ]+_\d{8}(T\d{6}Z)? /.test(decoded);
}

interface Report {
  path: string;
  problems: string[];
  summary: string[];
}

async function phase2Checks(manifest: BackfillManifest, rows: RawEventData[], changed: Changed[], migrationSql: string[], report: Report): Promise<void> {
  const p = report.problems;
  const history = changed.filter((c) => HISTORY_RE.test(c.file));
  const added = history.filter((c) => c.status === "A");
  if (history.length !== 2 || added.length !== 2 || !added.some((c) => c.file === manifest.archivePath) || !added.some((c) => c.file === report.path)) {
    p.push("an archive-source PR adds exactly one archive and one manifest, both new, and changes nothing else under scripts/data/*-history*");
  }
  const sources = SOURCES as unknown as SeedSource[];
  const kennel = manifest.expectedKennelCodes[0];
  if (manifest.expectedKennelCodes.length !== 1) p.push("Phase 2 takes exactly one kennel");
  if (manifest.sourceName === manifest.originSourceName) p.push("the archive source and the origin must be different sources");
  for (const name of [manifest.sourceName, manifest.originSourceName]) {
    const count = sources.filter((s) => s.name === name).length;
    if (count > 1) p.push(`${count} seed sources are named "${name}"`);
  }
  const origin = sources.find((s) => s.name === manifest.originSourceName);
  const archive = sources.find((s) => s.name === manifest.sourceName);
  if (!origin) p.push(`the origin "${manifest.originSourceName}" isn't in prisma/seed-data/sources.ts`);
  if (!archive) p.push(`the archive source "${manifest.sourceName}" isn't in prisma/seed-data/sources.ts`);
  if (origin) {
    if (!SUPPORTED_ORIGIN_TYPES.has(origin.type)) p.push(`origin type ${origin.type} has no provenance rule (supervised)`);
    if (JSON.stringify(origin.kennelCodes ?? []) !== JSON.stringify([kennel])) p.push("the origin must feed this kennel only");
    const cfg = (origin.config ?? {}) as { kennelPatterns?: unknown; defaultKennelTag?: unknown };
    if ((cfg.defaultKennelTag && cfg.defaultKennelTag !== kennel) || (Array.isArray(cfg.kennelPatterns) && cfg.kennelPatterns.length > 0)) {
      p.push("the origin's kennelPatterns or defaultKennelTag route to another kennel");
    }
    const otherHosts = websiteHosts(sources.filter((s) => (s.kennelCodes ?? []).some((k) => k !== kennel)).map((s) => s.url));
    const provenance = checkRowProvenance({ type: origin.type, url: origin.url, config: origin.config ?? null }, rows.map((r) => r.sourceUrl), otherHosts);
    if (!provenance.ok) p.push(provenance.supervised ? `provenance: ${provenance.reason}` : `provenance: ${provenance.failures.length} rows' sourceUrl doesn't prove the origin`);
    if (origin.type === "GOOGLE_CALENDAR") {
      const missing = checkSeriesMarkerKeys(rows);
      if (missing.length) p.push(`G21: ${missing.length} rows lack the recurringSeriesId key (write an explicit null)`);
      const nullOnInstance = rows.filter((r) => r.recurringSeriesId == null && isInstanceEid(r.sourceUrl)).length;
      report.summary.push(`- Calendar rows whose link names a repeating instance but carry a null series marker: **${nullOnInstance}** (the adapter drops the marker on orphan overrides; for the owner to read)`);
    }
  }
  if (archive) {
    if (archive.enabled !== false || archive.archiveOnly !== true) p.push("the archive source must be seeded with enabled: false and archiveOnly: true");
    if (JSON.stringify(archive.kennelCodes ?? []) !== JSON.stringify([kennel])) p.push("the archive source must be linked to the kennel only");
    if (origin && archive.type !== origin.type) p.push("the archive source's type must be the origin's");
  }
  // The migration's own insert decides prod (the seed runs only locally): archiveOnly true, enabled false, literally.
  const inserts = (await Promise.all(migrationSql.map((sql) => findSourceInserts(sql, manifest.sourceName)))).flat();
  if (inserts.length !== 1) p.push(`an added migration must insert the archive source exactly once (found ${inserts.length})`);
  else if (inserts[0].archiveOnly !== true || inserts[0].enabled !== false) p.push("the migration must insert the archive source with archiveOnly = true and enabled = false, literally");
  else if (inserts[0].id && !migrationSql.some((sql) => sql.includes("SourceKennel") && sql.includes(`'${inserts[0].id}'`))) p.push("no added migration links the archive source to its kennel");
  if (checkRowShape(rows).length) p.push("rows with seriesId, seriesParent or externalLinks");
  p.push(...checkRunOrder(rows));
  p.push(...checkSize(rows.length));
}

function failedToLoad(report: Report, err: unknown): Report {
  report.problems.push(err instanceof Error ? err.message : String(err));
  report.summary.push(`### ${report.path}`, "", `**Couldn't load:** ${report.problems[0]}`, "");
  return report;
}

async function checkManifest(path: string, changed: Changed[], migrationSql: string[]): Promise<Report> {
  const report: Report = { path, problems: [], summary: [] };
  const p = report.problems;
  let manifest: BackfillManifest;
  let archiveBytes: string;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8")) as BackfillManifest;
    if (!HISTORY_RE.test(manifest.archivePath) || manifest.archivePath.endsWith(".manifest.json")) throw new Error("archivePath isn't an archive under scripts/data");
    if (!existsSync(manifest.archivePath)) throw new Error(`${manifest.archivePath} doesn't exist`);
    archiveBytes = readFileSync(manifest.archivePath, "utf8");
  } catch (err) {
    return failedToLoad(report, err);
  }
  let rows: RawEventData[];
  try {
    rows = parseArchive(archiveBytes);
  } catch (err) {
    return failedToLoad(report, err);
  }

  // Every manifest.
  p.push(...compareManifest(manifest, archiveBytes).map((x) => `G2: ${x.detail}`));
  p.push(...checkDeclaredFields(manifest, rows).map((x) => x.detail));
  // frozenAt must be a real date no later than tomorrow (UTC), so rows can't be dated in the future.
  const tomorrow = addDays(new Date().toISOString().slice(0, 10), 1);
  const frozenOk = /^\d{4}-\d{2}-\d{2}$/.test(manifest.frozenAt) && new Date(`${manifest.frozenAt}T12:00:00Z`).toISOString().slice(0, 10) === manifest.frozenAt;
  if (!frozenOk || manifest.frozenAt > tomorrow) p.push(`frozenAt ${manifest.frozenAt} must be a real YYYY-MM-DD date, not in the future`);
  const badDates = checkRowDates(rows, tomorrow, manifest.frozenAt);
  if (badDates.length) p.push(`${badDates.length} rows aren't real dates before frozenAt (${manifest.frozenAt})`);
  const expected = new Set(manifest.expectedKennelCodes);
  const badTags = rows.filter((r) => r.kennelTags.length !== 1 || !expected.has(r.kennelTags[0])).length;
  if (badTags) p.push(`${badTags} rows don't carry exactly one expected kennel tag`);
  const pii = scanArchiveForPii(rows);
  if (pii.length) p.push(`PII: ${pii.length} hits (${Object.entries(summarizePiiHits(pii)).map(([k, v]) => `${k} ×${v}`).join(", ")}). A hit after push is a leak: see design 8.2`);

  if (manifest.binding === "archive-source") {
    await phase2Checks(manifest, rows, changed, migrationSql, report);
    for (const sql of migrationSql) p.push(...(await checkMigrationForBackfill(sql)).map((x) => `G17: ${x}`));
    if (manifest.expectedKennelCodes.length === 1 && checkRowRouting(rows, manifest.expectedKennelCodes[0]).length) p.push("G4: rows must carry exactly the expected kennel code");
  } else if (manifest.binding === "adopt-only") {
    const history = changed.filter((c) => HISTORY_RE.test(c.file));
    if (history.length !== 1 || history[0].file !== path || history[0].status !== "A") p.push("an adopt-only PR adds just the manifest, for an archive it doesn't change");
  } else {
    p.push(`unknown binding ${String(manifest.binding)}`);
  }

  // The summary the owner reads before labelling (6.2).
  const s = report.summary;
  s.unshift(
    `### ${path}`,
    "",
    `- Binding: **${manifest.binding}** · archive \`${manifest.archivePath}\` (sha256 \`${manifest.archiveSha256.slice(0, 12)}…\`) · source "${manifest.sourceName}" · origin "${manifest.originSourceName}"`,
    `- Frozen at ${manifest.frozenAt} (${manifest.kennelTimezone}) · approval hash \`${manifest.approvalHash}\``,
    "",
    "| Kennel | Rows | Unique dates | First | Last | No run number | Samples |",
    "|---|---|---|---|---|---|---|",
    ...Object.entries(manifest.perKennel).map(([k, v]) => `| ${k} | ${v.rows} | ${v.uniqueDates} | ${v.firstDate} | ${v.lastDate} | ${v.rowsWithoutRunNumber} | ${v.sampleTitles.map((t) => t.replaceAll("|", "/")).join(" · ")} |`),
    "",
    `- Same-date groups: ${manifest.sameDateGroups.length ? manifest.sameDateGroups.map((g) => `${g.date} (${g.runNumbers.join(", ")})`).join("; ") : "none"}`,
    `- Run-number exceptions: ${manifest.runNumberExceptions.length ? manifest.runNumberExceptions.map((e) => `row ${e.row} #${e.runNumber} on ${e.date}`).join("; ") : "none"}`,
    `- Usual-schedule estimate (not part of the hash): ${manifest.scheduleOnlyEstimate}`,
    `- Curated corrections: ${manifest.curatedCorrections.length}`,
  );
  const interval = medianRunInterval(rows.map((r) => r.date).sort(), []);
  for (const g of manifest.expectedGaps) {
    const days = daysBetween(g.start, addDays(g.end, 1));
    s.push(`- Declared gap ${g.start}..${g.end} (${g.reason}): ${days} days, about ${interval ? (days / interval).toFixed(1) : "?"} median run intervals removed from the gap rule`);
  }
  s.push("", p.length ? `**${p.length} problem(s):**\n${p.map((x) => `- ${x}`).join("\n")}` : "**All checks pass.**", "");
  return report;
}

async function main() {
  const fromStdin = process.argv.includes("--stdin");
  const changed = fromStdin ? parseNameStatus(readFileSync(0, "utf8")) : process.argv.slice(2).map((file) => ({ status: "A", file }));
  const manifests = changed.filter((c) => c.status !== "D" && HISTORY_RE.test(c.file) && c.file.endsWith(".manifest.json")).map((c) => c.file);
  const migrationSql = changed.filter((c) => c.status === "A" && MIGRATION_RE.test(c.file)).map((c) => readFileSync(c.file, "utf8"));
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  // An archive or manifest already on main is history someone applied: changing or deleting it
  // would let a later adopt-only PR adopt a rewrite. Flagged in the summary for the reviewer; not a
  // failure, because supervised hand-run archives are still re-frozen in place (design 12.2).
  const rewritten = changed.filter((c) => (c.status === "M" || c.status === "D") && HISTORY_RE.test(c.file));
  if (manifests.length === 0) {
    const text = rewritten.length
      ? `## Backfill manifest\n\n**This PR changes or deletes existing archives or manifests:** ${rewritten.map((c) => `${c.file} (${c.status})`).join(", ")}. If this archive was already applied, prefer a new archive under a new name.\n`
      : "No backfill manifest in this PR.\n";
    console.log(text);
    if (summaryFile) appendFileSync(summaryFile, text);
    return;
  }
  let failed = false;
  const out: string[] = ["## Backfill manifest", ""];
  if (manifests.length > 1) {
    failed = true;
    out.push(`**A PR may carry one manifest; this one has ${manifests.length}.**`, "");
  }
  for (const path of manifests) {
    const report = await checkManifest(path, changed, migrationSql);
    out.push(...report.summary);
    if (report.problems.length) failed = true;
  }
  const text = out.join("\n");
  console.log(text);
  if (summaryFile) appendFileSync(summaryFile, `${text}\n`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
