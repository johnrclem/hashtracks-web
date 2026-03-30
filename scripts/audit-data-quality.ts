/**
 * Automated data quality audit — queries upcoming events for known bad patterns.
 * Uses the same check functions as the API route, with a standalone DB connection.
 *
 * Usage:
 *   npx tsx scripts/audit-data-quality.ts              # dry run (print findings)
 *   npx tsx scripts/audit-data-quality.ts --post-issue  # create GitHub issue via gh CLI
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import pg from "pg";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AuditFinding } from "../src/pipeline/audit-checks";
import { runChecks } from "../src/pipeline/audit-runner";
import { formatIssueTitle, formatIssueBody } from "../src/pipeline/audit-format";

const postIssue = process.argv.includes("--post-issue");

function postGitHubIssue(findings: AuditFinding[]): void {
  const today = new Date().toISOString().split("T")[0];
  const title = formatIssueTitle(findings, today);
  const body = formatIssueBody(findings);

  console.log(`\nCreating GitHub issue: ${title}`);
  const bodyFile = path.join(os.tmpdir(), `audit-issue-${Date.now()}.md`);
  try {
    fs.writeFileSync(bodyFile, body);
    const result = spawnSync("gh", [
      "issue", "create",
      "--repo", process.env.GITHUB_REPOSITORY ?? "johnrclem/hashtracks-web",
      "--title", title,
      "--label", "audit",
      "--label", "claude-fix",
      "--label", "alert",
      "--body-file", bodyFile,
    ], { encoding: "utf8" });
    if (result.status === 0) {
      console.log(`Issue created: ${result.stdout.trim()}`);
    } else {
      console.error("Failed to create GitHub issue:", result.stderr);
    }
  } finally {
    try { fs.unlinkSync(bodyFile); } catch { /* ignore cleanup errors */ }
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(postIssue ? "📋 AUDIT — will post GitHub issue\n" : "🔍 AUDIT — dry run\n");

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7);
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 90);

  const events = await prisma.event.findMany({
    where: { date: { gte: cutoffDate, lte: futureDate }, status: "CONFIRMED" },
    select: {
      id: true, title: true, haresText: true, description: true,
      locationName: true, locationCity: true, startTime: true,
      runNumber: true, date: true, sourceUrl: true,
      kennel: { select: { shortName: true, kennelCode: true } },
      rawEvents: {
        take: 1, orderBy: [{ scrapedAt: "desc" }],
        select: { rawData: true, source: { select: { type: true, scrapeDays: true } } },
      },
    },
  });

  console.log(`Queried ${events.length} upcoming events\n`);

  const rows = events.map(e => ({
    id: e.id, kennelShortName: e.kennel.shortName, kennelCode: e.kennel.kennelCode,
    haresText: e.haresText, title: e.title, description: e.description,
    locationName: e.locationName, locationCity: e.locationCity,
    startTime: e.startTime, runNumber: e.runNumber,
    date: e.date.toISOString().split("T")[0], sourceUrl: e.sourceUrl,
    sourceType: e.rawEvents[0]?.source?.type ?? "UNKNOWN",
    scrapeDays: e.rawEvents[0]?.source?.scrapeDays ?? 90,
    rawDescription: (e.rawEvents[0]?.rawData as Record<string, unknown>)?.description as string | null ?? null,
  }));

  const { findings, summary } = runChecks(rows);

  if (findings.length === 0) {
    console.log("✅ No issues found!");
  } else {
    console.log(`Found ${findings.length} issues:`);
    for (const [cat, count] of Object.entries(summary)) {
      console.log(`  ${cat}: ${count}`);
    }
    console.log("");
    for (const f of findings) {
      console.log(`  [${f.severity}] ${f.kennelShortName}: ${f.rule} — "${f.currentValue.slice(0, 60)}"`);
    }
    if (postIssue) postGitHubIssue(findings);
  }

  await prisma.$disconnect();
  pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
