/**
 * AI-powered kennel discovery — uses Gemini search grounding to find
 * all Hash House Harrier kennels operating in a given region.
 *
 * Creates KennelDiscovery records (externalSource = "GEMINI") scoped
 * by regionId. Fuzzy-matches against existing kennels to avoid dupes.
 */

import { prisma } from "@/lib/db";
import { searchAndExtract } from "@/lib/ai/gemini";
import { fuzzyMatch, type FuzzyCandidate } from "@/lib/fuzzy";
import { toKennelCode } from "@/lib/kennel-utils";
import { Prisma } from "@/generated/prisma/client";

export interface KennelDiscoveryResult {
  discovered: number;
  matched: number;
  skipped: number;
  errors: string[];
}

/** Shape of a single kennel entry returned by Gemini. */
interface GeminiKennelEntry {
  fullName?: string;
  shortName?: string;
  website?: string;
  location?: string;
  schedule?: string;
  foundedYear?: number;
}

/** Build the search prompt for kennel discovery (natural language — no JSON format). */
export function buildSearchPrompt(regionName: string): string {
  return [
    `List ALL Hash House Harrier kennels operating in or near ${regionName}.`,
    "Include full official names, common abbreviations (e.g. EBH3), websites, city/area locations, run schedules, and founding years.",
    "Include all kennels — even small, inactive, or infrequently running ones.",
    "Only include legitimate Hash House Harrier kennels (not other running clubs).",
  ].join("\n");
}

/** Build the extraction prompt that converts prose into structured JSON. */
export function buildExtractionPrompt(searchText: string): string {
  return [
    "Extract kennel data from the following text as a JSON array of objects.",
    "Each object must have these fields:",
    '  fullName (string): full official name (e.g. "East Bay Hash House Harriers")',
    '  shortName (string): common abbreviation (e.g. "EBH3")',
    '  website (string|null): kennel website URL or null',
    '  location (string|null): city/area or null',
    '  schedule (string|null): run schedule or null',
    '  foundedYear (number|null): year founded or null',
    "",
    "Return ONLY the JSON array.",
    "",
    "Text:",
    searchText,
  ].join("\n");
}

/** Extract a JSON array from text that may contain surrounding prose. */
export function extractJsonArray(text: string): unknown {
  const cleaned = text
    .replace(/^```json?\n?/m, "")
    .replace(/\n?```$/m, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: find first [ to last ] — handles nested brackets reliably
    const firstBracket = cleaned.indexOf("[");
    const lastBracket = cleaned.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
      } catch { /* fall through */ }
    }
    throw new Error("No JSON array found in response");
  }
}

/** Parse the Gemini response text into structured entries. */
export function parseDiscoveryResponse(text: string): GeminiKennelEntry[] {
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return [];

  const entries: GeminiKennelEntry[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;

    const fullName = typeof item.fullName === "string" ? item.fullName.trim() : undefined;
    const shortName = typeof item.shortName === "string" ? item.shortName.trim() : undefined;

    // Must have at least one name
    if (!fullName && !shortName) continue;

    entries.push({
      fullName,
      shortName,
      website: typeof item.website === "string" && item.website.startsWith("http")
        ? item.website.trim()
        : undefined,
      location: typeof item.location === "string" ? item.location.trim() : undefined,
      schedule: typeof item.schedule === "string" ? item.schedule.trim() : undefined,
      foundedYear: typeof item.foundedYear === "number" && item.foundedYear > 1900
        ? item.foundedYear
        : undefined,
    });
  }

  return entries;
}

/** Generate a deterministic external slug for Gemini-discovered kennels. */
function geminiSlug(entry: GeminiKennelEntry): string {
  return toKennelCode(entry.shortName || entry.fullName || "unknown");
}

/**
 * Discover all Hash House Harrier kennels in a region via Gemini AI search.
 *
 * Steps:
 * 1. Load region + existing kennels (for dedup)
 * 2. Load existing KennelDiscovery records for region (for dedup)
 * 3. Call searchWithGemini with structured prompt
 * 4. Parse response → validate entries
 * 5. Fuzzy-match against existing kennels
 * 6. Create KennelDiscovery records
 */
export async function discoverKennelsForRegion(
  regionId: string,
): Promise<KennelDiscoveryResult> {
  const errors: string[] = [];

  // Load region
  const region = await prisma.region.findUnique({
    where: { id: regionId },
    select: { id: true, name: true },
  });
  if (!region) {
    return { discovered: 0, matched: 0, skipped: 0, errors: ["Region not found"] };
  }

  // Load existing kennels in this region (for fuzzy matching)
  const existingKennels = await prisma.kennel.findMany({
    where: { regionId },
    select: { id: true, shortName: true, fullName: true, aliases: { select: { alias: true } } },
  });

  // Load existing Gemini discoveries for this region (to skip already-discovered)
  const existingDiscoveries = await prisma.kennelDiscovery.findMany({
    where: { externalSource: "GEMINI", regionId },
    select: { externalSlug: true },
  });
  const existingSlugs = new Set(existingDiscoveries.map((d) => d.externalSlug));

  // Two-step: search grounding → JSON extraction
  const searchResult = await searchAndExtract(
    buildSearchPrompt(region.name),
    (text) => buildExtractionPrompt(text),
    8192,
  );

  if (searchResult.error) {
    errors.push(`AI search error: ${searchResult.error}`);
  }

  if (!searchResult.text) {
    return { discovered: 0, matched: 0, skipped: 0, errors };
  }

  // Parse response
  let entries: GeminiKennelEntry[];
  try {
    entries = parseDiscoveryResponse(searchResult.text);
  } catch {
    errors.push("Failed to parse AI discovery response as JSON");
    return { discovered: 0, matched: 0, skipped: 0, errors };
  }

  if (entries.length === 0) {
    return { discovered: 0, matched: 0, skipped: 0, errors };
  }

  // Build fuzzy candidates from existing kennels
  const fuzzyCandidates: FuzzyCandidate[] = existingKennels.map((k) => ({
    id: k.id,
    shortName: k.shortName,
    fullName: k.fullName,
    aliases: k.aliases.map((a) => a.alias),
  }));

  let discovered = 0;
  let matched = 0;
  let skipped = 0;

  for (const entry of entries) {
    const slug = geminiSlug(entry);
    if (!slug) continue;

    // Skip if already discovered
    if (existingSlugs.has(slug)) {
      skipped++;
      continue;
    }

    // Fuzzy match against existing kennels
    const searchTerm = entry.shortName || entry.fullName || "";
    const matches = fuzzyMatch(searchTerm, fuzzyCandidates, 3);
    const bestMatch = matches[0];
    const isMatch = bestMatch && bestMatch.score >= 0.8;

    try {
      await prisma.kennelDiscovery.upsert({
        where: {
          externalSource_externalSlug: {
            externalSource: "GEMINI",
            externalSlug: slug,
          },
        },
        create: {
          externalSource: "GEMINI",
          externalSlug: slug,
          name: entry.fullName || entry.shortName || slug,
          location: entry.location ?? null,
          website: entry.website ?? null,
          schedule: entry.schedule ?? null,
          yearStarted: entry.foundedYear ?? null,
          regionId,
          status: isMatch ? "MATCHED" : "NEW",
          matchedKennelId: isMatch ? bestMatch.id : null,
          matchScore: bestMatch?.score ?? null,
          matchCandidates: matches.length > 0
            ? (matches.map((m) => ({ id: m.id, shortName: m.shortName, score: m.score })) as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
        update: {
          name: entry.fullName || entry.shortName || slug,
          location: entry.location ?? null,
          website: entry.website ?? null,
          schedule: entry.schedule ?? null,
          yearStarted: entry.foundedYear ?? null,
          regionId,
          lastSeenAt: new Date(),
        },
      });

      existingSlugs.add(slug);
      if (isMatch) matched++;
      else discovered++;
    } catch (err) {
      errors.push(`Failed to save discovery "${slug}": ${err}`);
    }
  }

  return { discovered, matched, skipped, errors };
}
