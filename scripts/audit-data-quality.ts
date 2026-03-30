/**
 * Automated data quality audit — queries upcoming events for known bad patterns.
 *
 * Usage:
 *   npx tsx scripts/audit-data-quality.ts              # dry run (print findings)
 *   npx tsx scripts/audit-data-quality.ts --post-issue  # create GitHub issue
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import pg from "pg";
import { execSync } from "child_process";
import fs from "fs";
import {
  checkHareQuality,
  checkTitleQuality,
  checkLocationQuality,
  checkEventQuality,
  checkDescriptionQuality,
  type AuditFinding,
} from "../src/pipeline/audit-checks";
import { formatIssueTitle, formatIssueBody } from "./audit-format";

const postIssue = process.argv.includes("--post-issue");

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(postIssue ? "📋 AUDIT — will post GitHub issue\n" : "🔍 AUDIT — dry run\n");

  // Query upcoming events (next 90 days) with kennel + source data
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7);
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 90);

  const events = await prisma.event.findMany({
    where: {
      date: { gte: cutoffDate, lte: futureDate },
      status: "CONFIRMED",
    },
    select: {
      id: true,
      title: true,
      haresText: true,
      description: true,
      locationName: true,
      locationCity: true,
      startTime: true,
      runNumber: true,
      date: true,
      sourceUrl: true,
      kennel: { select: { shortName: true, kennelCode: true } },
      rawEvents: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: {
          rawData: true,
          source: { select: { type: true, scrapeDays: true } },
        },
      },
    },
  });

  console.log(`Queried ${events.length} upcoming events\n`);

  // Flatten for check functions
  const rows = events.map(e => ({
    id: e.id,
    kennelShortName: e.kennel.shortName,
    kennelCode: e.kennel.kennelCode,
    haresText: e.haresText,
    title: e.title,
    description: e.description,
    locationName: e.locationName,
    locationCity: e.locationCity,
    startTime: e.startTime,
    runNumber: e.runNumber,
    date: e.date.toISOString().split("T")[0],
    sourceUrl: e.sourceUrl,
    sourceType: e.rawEvents[0]?.source?.type ?? "UNKNOWN",
    scrapeDays: e.rawEvents[0]?.source?.scrapeDays ?? 90,
    rawDescription: (e.rawEvents[0]?.rawData as Record<string, unknown>)?.description as string | null ?? null,
  }));

  // Run all checks
  const findings: AuditFinding[] = [
    ...checkHareQuality(rows),
    ...checkTitleQuality(rows),
    ...checkLocationQuality(rows),
    ...checkEventQuality(rows),
    ...checkDescriptionQuality(rows.map(r => ({
      id: r.id,
      kennelShortName: r.kennelShortName,
      description: r.description,
      rawDescription: r.rawDescription,
      sourceUrl: r.sourceUrl,
      sourceType: r.sourceType,
    }))),
  ];

  // Print summary
  const byCategory = new Map<string, number>();
  for (const f of findings) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  }

  if (findings.length === 0) {
    console.log("✅ No issues found!");
  } else {
    console.log(`Found ${findings.length} issues:`);
    for (const [cat, count] of byCategory) {
      console.log(`  ${cat}: ${count}`);
    }
    console.log("");

    for (const f of findings) {
      console.log(`  [${f.severity}] ${f.kennelShortName}: ${f.rule} — "${f.currentValue.slice(0, 60)}"`);
    }

    if (postIssue) {
      const today = new Date().toISOString().split("T")[0];
      const title = formatIssueTitle(findings, today);
      const body = formatIssueBody(findings);

      console.log(`\nCreating GitHub issue: ${title}`);
      const bodyFile = "/tmp/audit-issue-body.md";
      fs.writeFileSync(bodyFile, body);

      try {
        const result = execSync(
          `gh issue create --repo johnrclem/hashtracks-web --title "${title}" --label audit --label claude-fix --body-file ${bodyFile}`,
          { encoding: "utf8" },
        );
        console.log(`Issue created: ${result.trim()}`);
      } catch (err) {
        console.error("Failed to create GitHub issue:", err);
      }
    }
  }

  await prisma.$disconnect();
  pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
