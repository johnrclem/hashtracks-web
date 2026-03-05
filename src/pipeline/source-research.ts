/**
 * Source research pipeline — discovers, classifies, and analyzes potential
 * data sources for kennels in a region. Persists results as SourceProposals.
 */

import { prisma } from "@/lib/db";
import { detectSourceType } from "@/lib/source-detect";
import { searchAndExtract } from "@/lib/ai/gemini";
import { analyzeUrlForProposal } from "@/pipeline/html-analysis";
import { discoverKennelsForRegion, extractJsonArray } from "@/pipeline/kennel-discovery-ai";
import { Prisma } from "@/generated/prisma/client";
import type { SourceType } from "@/generated/prisma/client";

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
  kennelsDiscovered: number;
  kennelsMatched: number;
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

export type ConfidenceLevel = "high" | "medium" | "low";

interface AnalysisResult {
  candidate: UrlCandidate;
  detectedType: SourceType | null;
  extractedConfig: Prisma.InputJsonValue | null;
  confidence: ConfidenceLevel | null;
  explanation: string | null;
  error?: string;
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

/** Normalize a URL for deduplication: lowercase + strip trailing slashes. */
export function normalizeUrl(url: string): string {
  const s = url.toLowerCase();
  let end = s.length;
  while (end > 0 && s[end - 1] === "/") end--;
  return s.slice(0, end);
}

/** Check if a URL belongs to a blocklisted domain. */
export function isBlocklistedDomain(urlStr: string): boolean {
  try {
    const hostname = new URL(urlStr).hostname;
    return GROUNDING_URL_BLOCKLIST.some(
      (d) => hostname === d || hostname.endsWith("." + d),
    );
  } catch {
    return false;
  }
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

// ─── Phase 1: URL Collection ────────────────────────────────────────────────

/** Parse Gemini search response JSON into URL candidates. */
export function parseGeminiSearchResults(
  text: string,
  unsourcedKennels: { id: string; shortName: string }[],
  searchQuery: string,
): UrlCandidate[] {
  const candidates: UrlCandidate[] = [];
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return candidates;

  for (const entry of parsed) {
    if (typeof entry?.url !== "string" || !entry.url.startsWith("http")) continue;
    const kennelStr = typeof entry.kennel === "string" && entry.kennel ? entry.kennel : "";
    const matchingKennel = kennelStr
      ? unsourcedKennels.find((k) => k.shortName.toLowerCase() === kennelStr.toLowerCase())
      : undefined;
    candidates.push({
      url: entry.url,
      kennelId: matchingKennel?.id,
      kennelName: kennelStr,
      discoveryMethod: "WEB_SEARCH",
      searchQuery,
    });
  }
  return candidates;
}

/** Deduplicate candidates against existing sources, proposals, and each other. */
async function deduplicateUrls(
  candidates: UrlCandidate[],
  regionId: string,
): Promise<UrlCandidate[]> {
  const [existingSourceUrls, existingProposalUrls] = await Promise.all([
    prisma.source.findMany({ select: { url: true } }),
    prisma.sourceProposal.findMany({
      where: { regionId },
      select: { url: true },
    }),
  ]);

  const existingUrlSet = new Set([
    ...existingSourceUrls.map((s) => normalizeUrl(s.url)),
    ...existingProposalUrls.map((p) => normalizeUrl(p.url)),
  ]);

  const seenUrls = new Set<string>();
  const deduped: UrlCandidate[] = [];
  for (const c of candidates) {
    const normalized = normalizeUrl(c.url);
    if (!existingUrlSet.has(normalized) && !seenUrls.has(normalized)) {
      seenUrls.add(normalized);
      deduped.push(c);
    }
  }
  return deduped;
}

/** Web search for a list of kennel names, returning URL candidates + errors. */
async function webSearchForKennels(
  names: string[],
  regionName: string,
  discoveryMethod: string,
  matcherList: { id: string; shortName: string }[],
): Promise<{ candidates: UrlCandidate[]; errors: string[] }> {
  if (names.length === 0) return { candidates: [], errors: [] };

  const candidates: UrlCandidate[] = [];
  const errors: string[] = [];
  const searchQuery = `Find event listing or hareline URLs for these hash house harrier kennels in ${regionName}: ${names.join(", ")}`;

  const searchResult = await searchAndExtract(
    searchQuery,
    (text) =>
      `Extract URLs from the following text as a JSON array of objects with format: [{"kennel": "KennelName", "url": "https://..."}]. Only include URLs that appear to be event listings or harelines.\n\nText:\n${text}`,
  );

  if (searchResult.text) {
    try {
      const parsed = parseGeminiSearchResults(searchResult.text, matcherList, searchQuery);
      for (const c of parsed) c.discoveryMethod = discoveryMethod;
      candidates.push(...parsed);
    } catch {
      errors.push(`Failed to parse Gemini search response for ${discoveryMethod}`);
    }
  }

  for (const gUrl of searchResult.groundingUrls) {
    if (!isBlocklistedDomain(gUrl)) {
      candidates.push({ url: gUrl, discoveryMethod, searchQuery });
    }
  }

  if (searchResult.error) {
    errors.push(`${discoveryMethod} web search error: ${searchResult.error}`);
  }

  return { candidates, errors };
}

/** Collect URL candidates from kennel websites, discoveries, and web search. */
async function collectUrlCandidates(
  regionId: string,
  regionName: string,
): Promise<{ candidates: UrlCandidate[]; errors: string[] }> {
  const errors: string[] = [];
  const urlCandidates: UrlCandidate[] = [];

  // Run all five DB queries in parallel
  const [kennelsWithWebsites, discoveries, unsourcedKennelsNoWeb, geminiDiscoveries, discoveryNoWeb] = await Promise.all([
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
    // Also include Gemini-discovered kennels with websites (not yet added)
    prisma.kennelDiscovery.findMany({
      where: {
        externalSource: "GEMINI",
        regionId,
        status: "NEW",
        website: { not: null },
      },
      select: { website: true, name: true },
    }),
    // Gemini-discovered kennels WITHOUT websites (need web search)
    prisma.kennelDiscovery.findMany({
      where: {
        externalSource: "GEMINI",
        regionId,
        status: { in: ["NEW", "MATCHED"] },
        website: null,
      },
      select: { name: true },
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

  // Add Gemini-discovered kennel websites (not yet in DB as kennels)
  for (const gd of geminiDiscoveries) {
    if (gd.website) {
      urlCandidates.push({
        url: gd.website,
        kennelName: gd.name,
        discoveryMethod: "DISCOVERY_WEBSITE",
      });
    }
  }

  // Web search for kennels/discoveries without websites (run in parallel)
  const webSearchResults = await Promise.all([
    webSearchForKennels(
      unsourcedKennelsNoWeb.map((k) => `${k.shortName} (${k.fullName})`),
      regionName,
      "WEB_SEARCH",
      unsourcedKennelsNoWeb,
    ),
    webSearchForKennels(
      discoveryNoWeb.map((d) => d.name),
      regionName,
      "DISCOVERY_SEARCH",
      [],
    ),
  ]);

  for (const ws of webSearchResults) {
    urlCandidates.push(...ws.candidates);
    errors.push(...ws.errors);
  }

  return { candidates: urlCandidates, errors };
}

// ─── Phase 2: Classify + Analyze ────────────────────────────────────────────

/** Classify and analyze URL candidates (concurrency-limited to 3). */
async function classifyAndAnalyze(candidates: UrlCandidate[]): Promise<AnalysisResult[]> {
  return mapWithConcurrency<UrlCandidate, AnalysisResult>(
    candidates,
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
}

// ─── Phase 3: Persist ───────────────────────────────────────────────────────

/** Persist analysis results as SourceProposals. */
async function persistProposals(
  results: AnalysisResult[],
  regionId: string,
): Promise<{ created: number; skipped: number; errors: string[] }> {
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const result of results) {
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
          extractedConfig: result.extractedConfig ?? Prisma.JsonNull,
          confidence: result.confidence,
          explanation: result.explanation,
          kennelName: result.candidate.kennelName ?? null,
          status: result.error ? "ERROR" : "PENDING",
        },
        update: {
          detectedType: result.detectedType,
          extractedConfig: result.extractedConfig ?? Prisma.JsonNull,
          confidence: result.confidence,
          explanation: result.explanation,
          status: result.error ? "ERROR" : "PENDING",
          kennelName: result.candidate.kennelName ?? null,
        },
      });
      created++;
    } catch (err) {
      skipped++;
      errors.push(`Failed to save proposal for ${result.candidate.url}: ${err}`);
    }
  }

  return { created, skipped, errors };
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

export async function researchSourcesForRegion(regionId: string): Promise<ResearchResult> {
  const start = Date.now();

  // Load region
  const region = await prisma.region.findUnique({
    where: { id: regionId },
    select: { id: true, name: true },
  });
  if (!region) {
    return {
      regionName: "Unknown",
      kennelsDiscovered: 0,
      kennelsMatched: 0,
      urlsDiscovered: 0,
      urlsAnalyzed: 0,
      proposalsCreated: 0,
      proposalsSkipped: 0,
      errors: ["Region not found"],
      durationMs: Date.now() - start,
    };
  }

  // Phase 0: Discover kennels via AI
  const discovery = await discoverKennelsForRegion(regionId);
  const errors: string[] = [...discovery.errors];

  // Phase 1: Collect URL candidates
  const { candidates: rawCandidates, errors: urlErrors } = await collectUrlCandidates(regionId, region.name);
  errors.push(...urlErrors);

  // Deduplicate
  const dedupedCandidates = await deduplicateUrls(rawCandidates, regionId);
  const urlsDiscovered = dedupedCandidates.length;

  // Phase 2: Classify + Analyze
  const analysisResults = await classifyAndAnalyze(dedupedCandidates);

  // Phase 3: Persist
  const persistence = await persistProposals(analysisResults, regionId);
  errors.push(...persistence.errors);

  return {
    regionName: region.name,
    kennelsDiscovered: discovery.discovered,
    kennelsMatched: discovery.matched,
    urlsDiscovered,
    urlsAnalyzed: analysisResults.length,
    proposalsCreated: persistence.created,
    proposalsSkipped: persistence.skipped,
    errors,
    durationMs: Date.now() - start,
  };
}
