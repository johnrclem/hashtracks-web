"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { SourceType } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { researchSourcesForRegion, buildDetectedConfig } from "@/pipeline/source-research";
import { detectSourceType } from "@/lib/source-detect";
import { validateSourceUrl } from "@/adapters/utils";
import { analyzeUrlForProposal, refineAnalysis } from "@/pipeline/html-analysis";

/** Trigger research for a region — discovers URLs, classifies, analyzes, persists proposals. */
export async function startRegionResearch(regionId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  try {
    const result = await researchSourcesForRegion(regionId);
    revalidatePath("/admin/research");
    return { success: true, ...result };
  } catch (err) {
    return { error: `Research failed: ${err}` };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Resolve the Source URL, type, config, name from proposal + overrides. */
function resolveSourceFields(
  proposal: { url: string; detectedType: SourceType | null; extractedConfig: Prisma.JsonValue | null; kennelId: string | null; sourceName: string | null; kennelName: string | null },
  overrides?: { name?: string; type?: SourceType; kennelId?: string; config?: string },
): { sourceType: SourceType; config: Prisma.InputJsonValue | undefined; sourceUrl: string; sourceName: string; kennelId: string | null } | { error: string } {
  const sourceType = overrides?.type ?? proposal.detectedType;
  if (!sourceType) return { error: "Source type is required" };

  let config: Prisma.InputJsonValue | undefined;
  if (overrides?.config) {
    try {
      config = JSON.parse(overrides.config) as Prisma.InputJsonValue;
    } catch {
      return { error: "Invalid config JSON" };
    }
  } else if (proposal.extractedConfig) {
    config = proposal.extractedConfig as Prisma.InputJsonValue;
  }

  // For structured source types, extract the meaningful identifier as the Source.url
  // (e.g., Google Calendar adapter reads source.url as calendarId)
  let sourceUrl = proposal.url;
  const resolvedConfig = config as Record<string, unknown> | undefined;
  if (sourceType === "GOOGLE_CALENDAR" && resolvedConfig?.calendarId) {
    sourceUrl = String(resolvedConfig.calendarId);
  } else if (sourceType === "GOOGLE_SHEETS" && resolvedConfig?.sheetId) {
    sourceUrl = String(resolvedConfig.sheetId);
  } else if (sourceType === "MEETUP" && resolvedConfig?.groupUrlname) {
    sourceUrl = `https://www.meetup.com/${resolvedConfig.groupUrlname}`;
  }

  const kennelId = overrides?.kennelId ?? proposal.kennelId;
  const sourceName = overrides?.name ?? proposal.sourceName ?? `Source: ${proposal.url}`;

  return { sourceType, config, sourceUrl, sourceName, kennelId };
}

/** Approve a proposal → create Source + SourceKennel (transactional). */
export async function approveProposal(
  proposalId: string,
  overrides?: {
    name?: string;
    type?: SourceType;
    kennelId?: string;
    config?: string;
  },
) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  try {
    const sourceId = await prisma.$transaction(async (tx) => {
      const proposal = await tx.sourceProposal.findUnique({
        where: { id: proposalId },
      });
      if (!proposal) throw new Error("Proposal not found");
      if (proposal.status === "APPROVED") throw new Error("Already approved");

      const resolved = resolveSourceFields(proposal, overrides);
      if ("error" in resolved) throw new Error(resolved.error);

      const source = await tx.source.create({
        data: {
          name: resolved.sourceName,
          url: resolved.sourceUrl,
          type: resolved.sourceType,
          config: resolved.config,
          enabled: true,
          trustLevel: 5,
        },
      });

      if (resolved.kennelId) {
        try {
          await tx.sourceKennel.create({
            data: { sourceId: source.id, kennelId: resolved.kennelId },
          });
        } catch (e: unknown) {
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
        }
      }

      await tx.sourceProposal.update({
        where: { id: proposalId },
        data: {
          status: "APPROVED",
          createdSourceId: source.id,
          processedBy: admin.id,
          processedAt: new Date(),
        },
      });

      return source.id;
    });

    revalidatePath("/admin/research");
    revalidatePath("/admin/sources");
    return { success: true, sourceId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Reject a single proposal. */
export async function rejectProposal(proposalId: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  await prisma.sourceProposal.update({
    where: { id: proposalId },
    data: {
      status: "REJECTED",
      processedBy: admin.id,
      processedAt: new Date(),
    },
  });

  revalidatePath("/admin/research");
  return { success: true };
}

/** Bulk reject proposals. */
export async function bulkRejectProposals(ids: string[]) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  await prisma.sourceProposal.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "REJECTED",
      processedBy: admin.id,
      processedAt: new Date(),
    },
  });

  revalidatePath("/admin/research");
  return { success: true };
}

// ── Feedback / Refinement Actions ────────────────────────────────────────────

/** Change URL and re-analyze (e.g., /index.php → /events.php). */
export async function updateProposalUrl(proposalId: string, newUrl: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  if (!newUrl.trim()) return { error: "URL required" };

  try {
    validateSourceUrl(newUrl);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid URL" };
  }

  // Step 1: Try deterministic detection
  const detected = detectSourceType(newUrl);
  if (detected) {
    const config = buildDetectedConfig(detected);
    await prisma.sourceProposal.update({
      where: { id: proposalId },
      data: {
        url: newUrl,
        detectedType: detected.type,
        extractedConfig: (Object.keys(config).length > 0 ? config : Prisma.JsonNull) as Prisma.InputJsonValue,
        confidence: "high",
        explanation: `Detected as ${detected.type} from URL pattern`,
        status: "PENDING",
      },
    });

    revalidatePath("/admin/research");
    return { success: true };
  }

  // Step 2: HTML analysis
  const analysis = await analyzeUrlForProposal(newUrl);

  await prisma.sourceProposal.update({
    where: { id: proposalId },
    data: {
      url: newUrl,
      detectedType: analysis.suggestedConfig ? "HTML_SCRAPER" : null,
      extractedConfig: analysis.suggestedConfig
        ? (analysis.suggestedConfig as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      confidence: analysis.confidence,
      explanation: analysis.explanation || analysis.error || null,
      status: analysis.error ? "ERROR" : "PENDING",
    },
  });

  revalidatePath("/admin/research");
  return { success: true };
}

/** Refine config with text feedback (e.g., "location is in column 3"). */
export async function refineProposal(proposalId: string, feedback: string) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  if (!feedback.trim()) return { error: "Feedback required" };

  const proposal = await prisma.sourceProposal.findUnique({
    where: { id: proposalId },
  });
  if (!proposal) return { error: "Proposal not found" };

  const currentConfig = (typeof proposal.extractedConfig === "object" && proposal.extractedConfig !== null)
    ? proposal.extractedConfig as Record<string, unknown>
    : {};

  const analysis = await refineAnalysis(proposal.url, currentConfig, feedback);

  await prisma.sourceProposal.update({
    where: { id: proposalId },
    data: {
      extractedConfig: analysis.suggestedConfig
        ? (analysis.suggestedConfig as unknown as Prisma.InputJsonValue)
        : undefined,
      confidence: analysis.confidence,
      explanation: analysis.explanation || analysis.error || null,
    },
  });

  revalidatePath("/admin/research");
  return { success: true };
}
