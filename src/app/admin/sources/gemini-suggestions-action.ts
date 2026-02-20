"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini";

export interface GeminiPatternSuggestion {
  /** JavaScript regex string (no delimiters) */
  pattern: string;
  /** Kennel shortName to map matched events to */
  tag: string;
  /** 0–1 confidence score */
  confidence: number;
  /** Short explanation shown as tooltip on the chip */
  reason: string;
}

/**
 * Use Gemini to suggest regex kennel patterns for unmatched tags.
 * Requires GEMINI_API_KEY to be set; returns an error otherwise.
 *
 * @param unmatchedTags  Tags that failed kennel resolution
 * @param sampleTitlesByTag  Sample event titles grouped by tag (for context)
 */
export async function getGeminiSuggestions(
  unmatchedTags: string[],
  sampleTitlesByTag: Record<string, string[]>,
): Promise<{ suggestions?: GeminiPatternSuggestion[]; error?: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  if (unmatchedTags.length === 0) return { suggestions: [] };

  const client = getGeminiClient();
  if (!client) return { error: "No Gemini API key configured" };

  // Fetch all known kennels to give Gemini context for matching
  const kennels = await prisma.kennel.findMany({
    select: { shortName: true, fullName: true },
    orderBy: { shortName: "asc" },
  });

  const kennelList = kennels
    .map((k) => `${k.shortName} | ${k.fullName}`)
    .join("\n");

  const tagList = unmatchedTags
    .map((tag) => {
      const titles = (sampleTitlesByTag[tag] ?? []).slice(0, 3);
      return titles.length > 0
        ? `- "${tag}": ${titles.join("; ")}`
        : `- "${tag}"`;
    })
    .join("\n");

  const prompt = `You are helping configure a hash run calendar aggregator.
Some kennel tags extracted from calendar events failed to match known kennels in the database.
Suggest a regex pattern and target kennel tag for each unmatched tag.

Known kennels (shortName | fullName):
${kennelList}

Unmatched tags with sample event titles:
${tagList}

Return JSON in exactly this format:
{"suggestions":[{"pattern":"regex","tag":"KENNELCODE","confidence":0.0,"reason":"brief explanation"}]}

Rules:
- pattern must be a valid JavaScript regex string (no slashes, no flags)
- tag must be one of the known kennel shortNames listed above; use the original tag only if no reasonable match exists
- confidence is 0.0–1.0 (1.0 = certain, 0.5 = plausible, below 0.4 = uncertain)
- reason is 1–2 sentences max explaining the match
- return exactly one suggestion per unmatched tag`;

  try {
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const text = response.text;
    if (!text) return { error: "Empty response from Gemini" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: "Gemini returned invalid JSON" };
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as Record<string, unknown>).suggestions)
    ) {
      return { error: "Unexpected response shape from Gemini" };
    }

    const suggestions = ((parsed as Record<string, unknown>).suggestions as unknown[])
      .filter(
        (s): s is GeminiPatternSuggestion =>
          typeof s === "object" &&
          s !== null &&
          typeof (s as Record<string, unknown>).pattern === "string" &&
          typeof (s as Record<string, unknown>).tag === "string" &&
          typeof (s as Record<string, unknown>).confidence === "number" &&
          typeof (s as Record<string, unknown>).reason === "string",
      )
      .map((s) => ({
        ...s,
        confidence: Math.max(0, Math.min(1, s.confidence)),
      }));

    return { suggestions };
  } catch (e) {
    return {
      error: `Gemini request failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
