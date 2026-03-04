/**
 * Source research pipeline — discovers, classifies, and analyzes potential
 * data sources for kennels in a region. Persists results as SourceProposals.
 */

import { prisma } from "@/lib/db";
import { detectSourceType } from "@/lib/source-detect";
import { searchWithGemini } from "@/lib/ai/gemini";
import { analyzeUrlForProposal } from "@/pipeline/html-analysis";
import type { Prisma, SourceType } from "@/generated/prisma/client";

/** Domains to exclude from grounding URLs (not hash kennel sites). */
const GROUNDING_URL_BLOCKLIST = [
  "google.com",
  "wikipedia.org",
  "facebook.com",
  "twitter.com",
];

/** Build config from detectSourceType result. */
export function buildDetectedConfig(detected: {
  extractedUrl?: string;
  sheetId?: string;
  groupUrlname?: string;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (detected.extractedUrl) config.calendarId = detected.extractedUrl;
  if (detected.sheetId) config.sheetId = detected.sheetId;
  if (detected.groupUrlname) config.groupUrlname = detected.groupUrlname;
  return config;
}

export interface ResearchResult {
  regionName: string;
  urlsDiscovered: number;
  urlsAnalyzed: number;
  proposalsCreated: number;
  proposalsSkipped: number;
  errors: string[];
  durationMs: number;
}

interface UrlCandidate {
  url: string;
  kennelId?: string;
  kennelName?: string;
  discoveryMethod: string;
  searchQuery?: string;
}

// ─── Concurrency helper ──────────────────────────────────────────────────────

/** Run async tasks with bounded concurrency. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

export async function researchSourcesForRegion(regionId: string): Promise<ResearchResult> {
  const start = Date.now();
  const errors: string[] = [];

  // Load region
  const region = await prisma.region.findUnique({
    where: { id: regionId },
    select: { id: true, name: true },
  });
  if (!region) {
    return {
      regionName: "Unknown",
      urlsDiscovered: 0,
      urlsAnalyzed: 0,
      proposalsCreated: 0,
      proposalsSkipped: 0,
      errors: ["Region not found"],
      durationMs: Date.now() - start,
    };
  }

  // ── Phase 1: URL Collection ────────────────────────────────────────────────

  const urlCandidates: UrlCandidate[] = [];

  // 1a + 1b + 1c: Run all three DB queries in parallel
  const [kennelsWithWebsites, discoveries, unsourcedKennelsNoWeb] = await Promise.all([
    prisma.kennel.findMany({
      where: {
        regionId,
        website: { not: null },
        sources: {
          none: { source: { type: { not: "HASHREGO" } } },
        },
      },
      select: { id: true, shortName: true, website: true },
    }),
    prisma.kennelDiscovery.findMany({
      where: {
        status: { in: ["LINKED", "ADDED"] },
        website: { not: null },
        matchedKennel: { regionId },
      },
      select: {
        website: true,
        name: true,
        matchedKennelId: true,
        matchedKennel: { select: { shortName: true } },
      },
    }),
    prisma.kennel.findMany({
      where: {
        regionId,
        website: null,
        sources: { none: {} },
      },
      select: { id: true, shortName: true, fullName: true },
    }),
  ]);

  for (const kennel of kennelsWithWebsites) {
    if (kennel.website) {
      urlCandidates.push({
        url: kennel.website,
        kennelId: kennel.id,
        kennelName: kennel.shortName,
        discoveryMethod: "KENNEL_WEBSITE",
      });
    }
  }

  for (const d of discoveries) {
    if (d.website) {
      urlCandidates.push({
        url: d.website,
        kennelId: d.matchedKennelId ?? undefined,
        kennelName: d.matchedKennel?.shortName ?? d.name,
        discoveryMethod: "DISCOVERY_WEBSITE",
      });
    }
  }

  if (unsourcedKennelsNoWeb.length > 0) {
    const kennelNames = unsourcedKennelsNoWeb
      .map((k) => `${k.shortName} (${k.fullName})`)
      .join(", ");
    const searchQuery = `Find event listing or hareline URLs for these hash house harrier kennels in ${region.name}: ${kennelNames}. Return a JSON array of objects with format: [{"kennel": "ShortName", "url": "https://..."}]`;

    const searchResult = await searchWithGemini(searchQuery);

    // Parse URLs from Gemini response
    if (searchResult.text) {
      try {
        const cleaned = searchResult.text
          .replace(/^```json?\n?/m, "")
          .replace(/\n?```$/m, "")
          .trim();
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (typeof entry?.url === "string" && entry.url.startsWith("http")) {
              const matchingKennel = unsourcedKennelsNoWeb.find(
                (k) => k.shortName.toLowerCase() === String(entry.kennel).toLowerCase(),
              );
              urlCandidates.push({
                url: entry.url,
                kennelId: matchingKennel?.id,
                kennelName: String(entry.kennel || ""),
                discoveryMethod: "WEB_SEARCH",
                searchQuery,
              });
            }
          }
        }
      } catch {
        errors.push("Failed to parse Gemini search response");
      }
    }

    // Also add grounding URLs
    for (const gUrl of searchResult.groundingUrls) {
      // Only include URLs that look like hash kennel sites (not Google, Wikipedia, etc.)
      if (!GROUNDING_URL_BLOCKLIST.some((domain) => gUrl.includes(domain))) {
        urlCandidates.push({
          url: gUrl,
          discoveryMethod: "WEB_SEARCH",
          searchQuery,
        });
      }
    }

    if (searchResult.error) {
      errors.push(`Web search error: ${searchResult.error}`);
    }
  }

  // 1d. Deduplicate URLs against existing sources and proposals
  const [existingSourceUrls, existingProposalUrls] = await Promise.all([
    prisma.source.findMany({ select: { url: true } }),
    prisma.sourceProposal.findMany({
      where: { regionId },
      select: { url: true },
    }),
  ]);

  const existingUrlSet = new Set([
    ...existingSourceUrls.map((s) => s.url.toLowerCase()),
    ...existingProposalUrls.map((p) => p.url.toLowerCase()),
  ]);

  // Deduplicate within candidates too
  const seenUrls = new Set<string>();
  const dedupedCandidates: UrlCandidate[] = [];
  for (const c of urlCandidates) {
    const normalized = c.url.toLowerCase().replace(/\/+$/, "");
    if (!existingUrlSet.has(normalized) && !seenUrls.has(normalized)) {
      seenUrls.add(normalized);
      dedupedCandidates.push(c);
    }
  }

  const urlsDiscovered = dedupedCandidates.length;

  // ── Phase 2: Classify + Analyze (concurrency-limited to 3) ─────────────────

  interface AnalysisResult {
    candidate: UrlCandidate;
    detectedType: SourceType | null;
    extractedConfig: Prisma.InputJsonValue | null;
    confidence: string | null;
    explanation: string | null;
    error?: string;
  }

  const analysisResults = await mapWithConcurrency<UrlCandidate, AnalysisResult>(
    dedupedCandidates,
    async (candidate) => {
      try {
        // Step 1: Try deterministic detection
        const detected = detectSourceType(candidate.url);
        if (detected) {
          const config = buildDetectedConfig(detected);
          return {
            candidate,
            detectedType: detected.type,
            extractedConfig: (Object.keys(config).length > 0 ? config : null) as Prisma.InputJsonValue,
            confidence: "high",
            explanation: `Detected as ${detected.type} from URL pattern`,
            error: undefined,
          };
        }

        // Step 2: HTML analysis via Gemini
        const analysis = await analyzeUrlForProposal(candidate.url);
        if (analysis.error) {
          return {
            candidate,
            detectedType: null,
            extractedConfig: null,
            confidence: null,
            explanation: analysis.error,
            error: analysis.error,
          };
        }

        return {
          candidate,
          detectedType: analysis.suggestedConfig ? "HTML_SCRAPER" as SourceType : null,
          extractedConfig: analysis.suggestedConfig as unknown as Prisma.InputJsonValue,
          confidence: analysis.confidence,
          explanation: analysis.explanation,
          error: undefined,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          candidate,
          detectedType: null,
          extractedConfig: null,
          confidence: null,
          explanation: msg,
          error: msg,
        };
      }
    },
    3,
  );

  // ── Phase 3: Persist ───────────────────────────────────────────────────────

  let proposalsCreated = 0;
  let proposalsSkipped = 0;

  for (const result of analysisResults) {
    try {
      await prisma.sourceProposal.upsert({
        where: {
          url_regionId: {
            url: result.candidate.url,
            regionId,
          },
        },
        create: {
          regionId,
          kennelId: result.candidate.kennelId ?? null,
          url: result.candidate.url,
          sourceName: result.candidate.kennelName
            ? `${result.candidate.kennelName} Website`
            : null,
          discoveryMethod: result.candidate.discoveryMethod,
          searchQuery: result.candidate.searchQuery ?? null,
          detectedType: result.detectedType,
          extractedConfig: result.extractedConfig ?? undefined,
          confidence: result.confidence,
          explanation: result.explanation,
          kennelName: result.candidate.kennelName ?? null,
          status: result.error ? "ERROR" : "PENDING",
        },
        update: {
          detectedType: result.detectedType,
          extractedConfig: result.extractedConfig ?? undefined,
          confidence: result.confidence,
          explanation: result.explanation,
          status: result.error ? "ERROR" : "PENDING",
          kennelName: result.candidate.kennelName ?? null,
        },
      });
      proposalsCreated++;
    } catch (err) {
      proposalsSkipped++;
      errors.push(`Failed to save proposal for ${result.candidate.url}: ${err}`);
    }
  }

  return {
    regionName: region.name,
    urlsDiscovered,
    urlsAnalyzed: analysisResults.length,
    proposalsCreated,
    proposalsSkipped,
    errors,
    durationMs: Date.now() - start,
  };
}
