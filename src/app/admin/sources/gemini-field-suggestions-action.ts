"use server";

import { getAdminUser } from "@/lib/auth";
import { getGeminiClient, GEMINI_MODEL } from "@/lib/gemini";
import isSafeRegex from "safe-regex2";

export type SuggestableField = "hares" | "runNumber";

export interface FieldPatternSuggestion {
  /** JavaScript regex string (no delimiters) with a capture group */
  pattern: string;
  /** Which field this pattern extracts */
  field: SuggestableField;
  /** 0-1 confidence score */
  confidence: number;
  /** Short explanation */
  reason: string;
  /** Example extraction from sample descriptions */
  example?: string;
}

/** Returns true if the string is a valid, ReDoS-safe regex. */
function isSafeRegexString(p: unknown): boolean {
  if (typeof p !== "string") return false;
  try {
    // nosemgrep: detect-non-literal-regexp — validating AI-suggested pattern
    const re = new RegExp(p); // NOSONAR
    return isSafeRegex(re);
  } catch {
    return false;
  }
}

const FIELD_DESCRIPTIONS: Record<SuggestableField, string> = {
  hares: "hare names — the people who organized/laid the trail (e.g., 'WHO ARE THE HARES: Alice & Bob')",
  runNumber: "run number — the sequential hash run number (e.g., 'Hash # 2658', 'Run #1234'). The capture group must match digits only.",
};

/**
 * Use Gemini to suggest regex patterns for extracting fields from event descriptions.
 * Returns patterns with capture groups that can be used in harePatterns/runNumberPatterns config.
 */
export async function suggestFieldPatterns(
  sampleDescriptions: string[],
  fields: SuggestableField[],
): Promise<{ suggestions?: FieldPatternSuggestion[]; error?: string }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  if (sampleDescriptions.length === 0 || fields.length === 0) {
    return { suggestions: [] };
  }

  const client = getGeminiClient();
  if (!client) return { error: "No Gemini API key configured" };

  const samples = sampleDescriptions
    .slice(0, 5)
    .map((d, i) => `${i + 1}. ${d.substring(0, 500)}`)
    .join("\n\n");

  const fieldList = fields
    .map((f) => `- ${f}: ${FIELD_DESCRIPTIONS[f]}`)
    .join("\n");

  const prompt = `You are helping configure a hash run calendar aggregator.
Given sample event descriptions from a calendar source, suggest JavaScript regex patterns to extract specific fields.

Sample event descriptions:
${samples}

Fields to extract:
${fieldList}

Return JSON in exactly this format:
{"suggestions":[{"pattern":"regex","field":"fieldName","confidence":0.0,"reason":"brief explanation","example":"extracted value from sample"}]}

Rules:
- pattern must be a valid JavaScript regex string (no slashes, no flags — flags are added automatically)
- Each pattern MUST have exactly one capture group (parentheses) that captures the desired value
- For runNumber: the capture group must match digits only, e.g., (\\d+)
- For hares: the capture group should match the name list after the label
- confidence is 0.0-1.0 (1.0 = certain the pattern works, 0.5 = plausible)
- Return 1-2 suggestions per field (best patterns found in the samples)
- If no clear pattern is found for a field, omit that field entirely
- example should show what the pattern would extract from one of the samples`;

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
        (s): s is FieldPatternSuggestion =>
          typeof s === "object" &&
          s !== null &&
          typeof (s as Record<string, unknown>).pattern === "string" &&
          typeof (s as Record<string, unknown>).field === "string" &&
          fields.includes((s as Record<string, unknown>).field as SuggestableField) &&
          typeof (s as Record<string, unknown>).confidence === "number" &&
          typeof (s as Record<string, unknown>).reason === "string" &&
          isSafeRegexString((s as Record<string, unknown>).pattern),
      )
      .map((s) => ({
        ...s,
        confidence: Math.max(0, Math.min(1, s.confidence)),
        example: typeof s.example === "string" ? s.example : undefined,
      }));

    return { suggestions };
  } catch (e) {
    return {
      error: `Gemini request failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
