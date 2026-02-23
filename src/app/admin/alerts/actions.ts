"use server";

import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { scrapeSource } from "@/pipeline/scrape";
import { resolveKennelTag, clearResolverCache } from "@/pipeline/kennel-resolver";
import type { Prisma } from "@/generated/prisma/client";

interface RepairLogEntry {
  action: string;
  timestamp: string;
  adminId: string;
  details: Record<string, unknown>;
  result: "success" | "error";
  resultMessage?: string;
}

function appendRepairLog(
  existing: Prisma.JsonValue | null,
  entry: RepairLogEntry,
): Prisma.InputJsonValue {
  const log = Array.isArray(existing) ? existing : [];
  return [...log, entry] as Prisma.InputJsonValue;
}

/** Build a repair log entry for a given action and result. */
function buildRepairEntry(
  action: string,
  adminId: string,
  details: Record<string, unknown>,
  result: "success" | "error",
  resultMessage?: string,
): RepairLogEntry {
  return {
    action,
    timestamp: new Date().toISOString(),
    adminId,
    details,
    result,
    resultMessage,
  };
}

/**
 * Auto-resolve an alert if all unmatched context tags now resolve.
 * Shared by createAliasFromAlert and createKennelFromAlert.
 */
async function autoResolveIfAllTagsMatched(
  alertId: string,
  alertContext: unknown,
  adminId: string,
): Promise<void> {
  const ctx = alertContext as { tags?: string[] } | null;
  if (!ctx?.tags) return;

  clearResolverCache();
  const remaining: string[] = [];
  for (const t of ctx.tags) {
    const result = await resolveKennelTag(t);
    if (!result.matched) remaining.push(t);
  }
  if (remaining.length === 0) {
    await prisma.alert.update({
      where: { id: alertId },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: adminId },
    });
  }
}

export async function acknowledgeAlert(alertId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return { error: "Alert not found" };
  if (alert.status !== "OPEN") return { error: "Alert is not open" };

  await prisma.alert.update({
    where: { id: alertId },
    data: { status: "ACKNOWLEDGED" },
  });

  revalidatePath("/admin/alerts");
  revalidatePath(`/admin/sources/${alert.sourceId}`);
  return { success: true };
}

export async function snoozeAlert(alertId: string, hours: number) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return { error: "Alert not found" };
  if (alert.status === "RESOLVED") return { error: "Alert is already resolved" };

  const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);

  await prisma.alert.update({
    where: { id: alertId },
    data: { status: "SNOOZED", snoozedUntil },
  });

  revalidatePath("/admin/alerts");
  revalidatePath(`/admin/sources/${alert.sourceId}`);
  return { success: true };
}

export async function resolveAlert(alertId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return { error: "Alert not found" };
  if (alert.status === "RESOLVED") return { error: "Alert is already resolved" };

  await prisma.alert.update({
    where: { id: alertId },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedBy: admin.id,
    },
  });

  revalidatePath("/admin/alerts");
  revalidatePath(`/admin/sources/${alert.sourceId}`);
  return { success: true };
}

export async function resolveAllForSource(sourceId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  await prisma.alert.updateMany({
    where: {
      sourceId,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
      resolvedBy: admin.id,
    },
  });

  revalidatePath("/admin/alerts");
  revalidatePath(`/admin/sources/${sourceId}`);
  return { success: true };
}

// ── Repair Actions ──

export async function rescrapeFromAlert(alertId: string, force = false) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return { error: "Alert not found" };

  const result = await scrapeSource(alert.sourceId, { force });

  await prisma.alert.update({
    where: { id: alertId },
    data: {
      repairLog: appendRepairLog(alert.repairLog,
        buildRepairEntry(
          "rescrape", admin.id,
          { forced: force, eventsFound: result.eventsFound, created: result.created },
          result.success ? "success" : "error",
          result.errors.length > 0 ? result.errors.slice(0, 3).join("; ") : undefined,
        ),
      ),
    },
  });

  revalidatePath("/admin/alerts");
  revalidatePath(`/admin/sources/${alert.sourceId}`);
  return {
    success: true,
    eventsFound: result.eventsFound,
    created: result.created,
    updated: result.updated,
  };
}

export async function createAliasFromAlert(
  alertId: string,
  tag: string,
  kennelId: string,
  rescrapeAfter: boolean,
) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return { error: "Alert not found" };

  // Check alias doesn't already exist
  const existing = await prisma.kennelAlias.findFirst({
    where: { alias: { equals: tag, mode: "insensitive" } },
  });
  if (existing) return { error: `Alias "${tag}" already exists` };

  // Create alias
  await prisma.kennelAlias.create({
    data: { kennelId, alias: tag },
  });

  // Record repair
  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { shortName: true },
  });
  await prisma.alert.update({
    where: { id: alertId },
    data: {
      repairLog: appendRepairLog(alert.repairLog,
        buildRepairEntry("create_alias", admin.id, { tag, kennelId, kennelName: kennel?.shortName }, "success"),
      ),
    },
  });

  if (rescrapeAfter) {
    clearResolverCache();
    await scrapeSource(alert.sourceId);
  }

  await autoResolveIfAllTagsMatched(alertId, alert.context, admin.id);

  revalidatePath("/admin/alerts");
  revalidatePath(`/admin/sources/${alert.sourceId}`);
  revalidatePath("/admin/kennels");
  return { success: true };
}

export async function createKennelFromAlert(
  alertId: string,
  tag: string,
  kennelData: { shortName: string; fullName: string; region: string },
  rescrapeAfter: boolean,
) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return { error: "Alert not found" };

  // Generate slug and kennelCode
  const slug = kennelData.shortName
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const kennelCode = kennelData.shortName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Check uniqueness
  const existingKennel = await prisma.kennel.findFirst({
    where: {
      OR: [
        { kennelCode },
        { slug },
        { shortName: kennelData.shortName, region: kennelData.region || "Unknown" },
      ],
    },
  });
  if (existingKennel) return { error: `Kennel "${kennelData.shortName}" already exists` };

  // Create kennel + alias + source link in transaction
  await prisma.$transaction([
    prisma.kennel.create({
      data: {
        kennelCode,
        shortName: kennelData.shortName,
        fullName: kennelData.fullName || kennelData.shortName,
        slug,
        region: kennelData.region || "Unknown",
        aliases: {
          create: tag !== kennelData.shortName ? [{ alias: tag }] : [],
        },
      },
    }),
    // Link to the alert's source
    prisma.sourceKennel.create({
      data: {
        sourceId: alert.sourceId,
        kennelId: "", // Placeholder — filled below
      },
    }),
  ].slice(0, 1)); // Only create kennel in transaction

  // Get the new kennel ID and create the source link
  const newKennel = await prisma.kennel.findFirst({
    where: { slug },
    select: { id: true },
  });
  if (newKennel) {
    await prisma.sourceKennel.create({
      data: { sourceId: alert.sourceId, kennelId: newKennel.id },
    });
  }

  // Record repair
  await prisma.alert.update({
    where: { id: alertId },
    data: {
      repairLog: appendRepairLog(alert.repairLog,
        buildRepairEntry("create_kennel", admin.id, { tag, shortName: kennelData.shortName, slug }, "success"),
      ),
    },
  });

  if (rescrapeAfter) {
    clearResolverCache();
    await scrapeSource(alert.sourceId);
  }

  await autoResolveIfAllTagsMatched(alertId, alert.context, admin.id);

  revalidatePath("/admin/alerts");
  revalidatePath(`/admin/sources/${alert.sourceId}`);
  revalidatePath("/admin/kennels");
  return { success: true };
}

export async function linkKennelToSource(
  alertId: string,
  kennelTag: string,
  rescrapeAfter: boolean,
) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) return { error: "Alert not found" };

  // Resolve the tag to a kennel
  clearResolverCache();
  const { kennelId, matched } = await resolveKennelTag(kennelTag);
  if (!matched || !kennelId) {
    return { error: `Cannot resolve "${kennelTag}" to a kennel` };
  }

  // Check if link already exists
  const existing = await prisma.sourceKennel.findUnique({
    where: { sourceId_kennelId: { sourceId: alert.sourceId, kennelId } },
  });
  if (existing) {
    return { error: `Kennel is already linked to this source` };
  }

  // Create the SourceKennel link
  await prisma.sourceKennel.create({
    data: { sourceId: alert.sourceId, kennelId },
  });

  const kennel = await prisma.kennel.findUnique({
    where: { id: kennelId },
    select: { shortName: true },
  });

  // Record repair
  await prisma.alert.update({
    where: { id: alertId },
    data: {
      repairLog: appendRepairLog(alert.repairLog, {
        action: "link_kennel",
        timestamp: new Date().toISOString(),
        adminId: admin.id,
        details: { tag: kennelTag, kennelId, kennelName: kennel?.shortName },
        result: "success",
      }),
    },
  });

  // Optionally re-scrape
  if (rescrapeAfter) {
    clearResolverCache();
    await scrapeSource(alert.sourceId, { force: true });
  }

  // Auto-resolve if all blocked tags are now linked
  const ctx = alert.context as { tags?: string[] } | null;
  if (ctx?.tags) {
    clearResolverCache();
    const sourceKennels = await prisma.sourceKennel.findMany({
      where: { sourceId: alert.sourceId },
      select: { kennelId: true },
    });
    const linkedIds = new Set(sourceKennels.map(sk => sk.kennelId));
    const remaining: string[] = [];
    for (const t of ctx.tags) {
      const result = await resolveKennelTag(t);
      if (!result.matched || !result.kennelId || !linkedIds.has(result.kennelId)) {
        remaining.push(t);
      }
    }
    if (remaining.length === 0) {
      await prisma.alert.update({
        where: { id: alertId },
        data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: admin.id },
      });
    }
  }

  revalidatePath("/admin/alerts");
  revalidatePath(`/admin/sources/${alert.sourceId}`);
  return { success: true, kennelName: kennel?.shortName };
}

export async function createIssueFromAlert(alertId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Unauthorized" };

  const token = process.env.GITHUB_TOKEN;
  if (!token) return { error: "GITHUB_TOKEN not configured" };

  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    include: { source: { select: { name: true, url: true, type: true } } },
  });
  if (!alert) return { error: "Alert not found" };

  const ctx = alert.context as Record<string, unknown> | null;
  const typeName = alert.type.replace(/_/g, " ").toLowerCase();
  const title = `[Alert] ${alert.title} — ${alert.source.name}`;

  // Build body based on alert type
  let contextSection = "";
  if (ctx) {
    switch (alert.type) {
      case "UNMATCHED_TAGS":
        contextSection = `### Unmatched Tags\n${(ctx.tags as string[]).map((t) => `- \`${t}\``).join("\n")}\n\nThese tags appeared in scraped events but couldn't be resolved to any kennel.\nThe kennel resolver checked: shortName → alias → pattern match → no match.`;
        break;
      case "EVENT_COUNT_ANOMALY":
        contextSection = `### Event Count\n- **Baseline avg:** ${ctx.baselineAvg} (last ${ctx.baselineWindow} scrapes)\n- **Current:** ${ctx.currentCount}\n- **Drop:** ${ctx.dropPercent}%`;
        break;
      case "FIELD_FILL_DROP":
        contextSection = `### Field Quality\n- **Field:** ${ctx.field}\n- **Baseline:** ${ctx.baselineAvg}%\n- **Current:** ${ctx.currentRate}%\n- **Drop:** ${(ctx.baselineAvg as number) - (ctx.currentRate as number)}pp`;
        break;
      case "STRUCTURE_CHANGE":
        contextSection = `### Structure Change\n- **Previous hash:** \`${(ctx.previousHash as string)?.slice(0, 16)}...\`\n- **Current hash:** \`${(ctx.currentHash as string)?.slice(0, 16)}...\`\n\nThe HTML tag hierarchy changed between scrapes, which may break field extraction.`;
        break;
      case "SCRAPE_FAILURE":
      case "CONSECUTIVE_FAILURES":
        contextSection = `### Errors\n${((ctx.errorMessages as string[]) ?? []).slice(0, 5).map((e) => `- ${e}`).join("\n")}${ctx.consecutiveCount ? `\n\n**Consecutive failures:** ${ctx.consecutiveCount}` : ""}`;
        break;
      case "SOURCE_KENNEL_MISMATCH":
        contextSection = `### Blocked Tags\n${(ctx.tags as string[]).map((t) => `- \`${t}\``).join("\n")}\n\nThese tags resolved to valid kennels but those kennels are not linked to this source via SourceKennel.`;
        break;
    }
  }

  const relevantFiles = getRelevantFiles(alert.type, alert.source.type);

  const body = `## Source Alert: ${typeName}

**Source:** ${alert.source.name} (${alert.source.type})
**URL:** ${alert.source.url}
**Severity:** ${alert.severity}
**Alert ID:** ${alert.id}

${contextSection}

### Relevant Files
${relevantFiles.map((f) => `- \`${f}\``).join("\n")}

### Suggested Approach
${getSuggestedApproach(alert.type, ctx)}

---
*Created from HashTracks admin alert panel*`;

  // Map alert type to label
  const typeLabel = `alert:${alert.type.toLowerCase().replace(/_/g, "-")}`;
  const severityLabel = `severity:${alert.severity.toLowerCase()}`;

  try {
    const res = await fetch(
      "https://api.github.com/repos/johnrclem/hashtracks-web/issues",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          body,
          labels: ["alert", typeLabel, severityLabel],
        }),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      return { error: `GitHub API ${res.status}: ${errBody.slice(0, 200)}` };
    }

    const issue = await res.json();
    const issueUrl = issue.html_url as string;

    // Record in repair log
    await prisma.alert.update({
      where: { id: alertId },
      data: {
        repairLog: appendRepairLog(alert.repairLog, {
          action: "create_issue",
          timestamp: new Date().toISOString(),
          adminId: admin.id,
          details: { issueUrl, issueNumber: issue.number },
          result: "success",
        }),
      },
    });

    revalidatePath("/admin/alerts");
    return { success: true, issueUrl };
  } catch (err) {
    return { error: `Failed to create issue: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}

function getRelevantFiles(alertType: string, sourceType: string): string[] {
  const files: string[] = [];

  switch (alertType) {
    case "UNMATCHED_TAGS":
      files.push("src/pipeline/kennel-resolver.ts");
      if (sourceType === "HTML_SCRAPER")
        files.push("src/adapters/html-scraper/hashnyc.ts");
      if (sourceType === "GOOGLE_CALENDAR")
        files.push("src/adapters/google-calendar/adapter.ts");
      files.push("prisma/seed.ts");
      break;
    case "STRUCTURE_CHANGE":
      files.push("src/adapters/html-scraper/hashnyc.ts");
      files.push("src/pipeline/structure-hash.ts");
      break;
    case "FIELD_FILL_DROP":
      if (sourceType === "HTML_SCRAPER")
        files.push("src/adapters/html-scraper/hashnyc.ts");
      if (sourceType === "GOOGLE_CALENDAR")
        files.push("src/adapters/google-calendar/adapter.ts");
      if (sourceType === "GOOGLE_SHEETS")
        files.push("src/adapters/google-sheets/adapter.ts");
      files.push("src/pipeline/fill-rates.ts");
      break;
    case "SCRAPE_FAILURE":
    case "CONSECUTIVE_FAILURES":
      files.push("src/pipeline/scrape.ts");
      if (sourceType === "HTML_SCRAPER")
        files.push("src/adapters/html-scraper/hashnyc.ts");
      if (sourceType === "GOOGLE_CALENDAR")
        files.push("src/adapters/google-calendar/adapter.ts");
      if (sourceType === "GOOGLE_SHEETS")
        files.push("src/adapters/google-sheets/adapter.ts");
      break;
    case "EVENT_COUNT_ANOMALY":
      files.push("src/pipeline/scrape.ts");
      files.push("src/pipeline/merge.ts");
      break;
    case "SOURCE_KENNEL_MISMATCH":
      files.push("src/pipeline/merge.ts");
      files.push("src/pipeline/kennel-resolver.ts");
      files.push("prisma/seed.ts");
      break;
  }

  return files;
}

function getSuggestedApproach(alertType: string, context?: Record<string, unknown> | null): string {
  // Check if AI recovery was attempted for this alert
  const ai = context?.aiRecovery as { attempted?: number; succeeded?: number; failed?: number } | undefined;
  const aiNote = ai && ai.attempted
    ? ai.failed && ai.failed > 0
      ? `\n\n**AI Recovery:** Attempted on ${ai.attempted} parse errors — ${ai.succeeded} recovered, ${ai.failed} failed. The failures likely represent format changes that need code-level fixes (new regex patterns or adapter logic).`
      : `\n\n**AI Recovery:** All ${ai.succeeded} parse errors were automatically recovered by AI. If this alert persists, consider adding the new format pattern to the deterministic parser for efficiency.`
    : "";

  switch (alertType) {
    case "UNMATCHED_TAGS":
      return "Add aliases in the database mapping these tags to existing kennels, or create new kennels if these are genuinely new organizations. Update kennel resolver patterns if a code-level mapping is needed.";
    case "STRUCTURE_CHANGE":
      return "Fetch the current page and compare HTML structure to the expected format. Update CSS selectors and extraction patterns in the adapter. Re-scrape to verify the fix." + aiNote;
    case "FIELD_FILL_DROP":
      return "Examine sample raw events to identify which extraction patterns stopped matching. For config-driven adapters, update Source.config. For HTML adapters, update extraction regex patterns." + aiNote;
    case "EVENT_COUNT_ANOMALY":
      return "Check if the source website is accessible. Verify the scrape window (days) is appropriate. Check for structural changes that may have broken event detection." + aiNote;
    case "SCRAPE_FAILURE":
    case "CONSECUTIVE_FAILURES":
      return "Check source URL accessibility. Review error messages for network, auth, or parsing failures. Verify API keys are valid.";
    case "SOURCE_KENNEL_MISMATCH":
      return "The kennel tag resolved to a valid kennel, but that kennel is not linked to this source via SourceKennel. Either add the SourceKennel link (if the source legitimately provides events for that kennel) or update the adapter/config to produce the correct tag.";
    default:
      return "Investigate the alert context and relevant files.";
  }
}
