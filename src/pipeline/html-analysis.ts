/**
 * Reusable HTML analysis pipeline — extracts event container detection and
 * Gemini column mapping from the admin server actions so they can be used
 * by the batch research pipeline without requiring admin auth.
 */

import { fetchHTMLPage, validateSourceUrl } from "@/adapters/utils";
import { callGemini } from "@/lib/ai/gemini";
import {
  getExamplesForLayout,
  formatExamplesForPrompt,
} from "@/adapters/html-scraper/examples";
import he from "he";
import type { GenericHtmlConfig, GenericHtmlColumns } from "@/adapters/html-scraper/generic";
import { findCandidateContainers } from "@/app/admin/sources/html-analysis-utils";
import type { ContainerCandidate } from "@/app/admin/sources/html-analysis-utils";
import type { CheerioAPI } from "cheerio";

/** Result of AI analysis + heuristic container detection. */
export interface HtmlAnalysisResult {
  candidates: ContainerCandidate[];
  suggestedConfig: GenericHtmlConfig | null;
  explanation: string;
  confidence: "high" | "medium" | "low" | null;
  error?: string;
  /** URLs discovered embedded in the page (Google Calendar links, iCal feeds, etc.) */
  embeddedUrls?: string[];
}

// ─── Prompt builders (shared by both analyze and refine) ──────────────────

/** Build the Gemini prompt for column mapping. */
export function buildAnalysisPrompt(
  candidate: ContainerCandidate,
  layoutType: string,
): string {
  const examples = getExamplesForLayout(layoutType);
  const examplesText = formatExamplesForPrompt(examples);

  const rowsText = candidate.sampleRows
    .map((row, i) => `  Row ${i}: ${JSON.stringify(row)}`)
    .join("\n");

  return `You are analyzing an HTML page that lists hash house harrier running events.

Here are examples of working configurations from similar sites:

${examplesText}

Now analyze these sample rows extracted from the page (${candidate.layoutType} layout):
Container: "${candidate.containerSelector}" → Row: "${candidate.rowSelector}"
${candidate.rowCount} total rows found.

Sample data:
${rowsText}

Based on the data patterns, determine which column/position contains which field.
For table layouts, use "td:nth-child(N)" selectors (1-indexed).
For div layouts, use CSS class selectors if visible, otherwise describe the pattern.

Respond with a JSON object:
{
  "columns": {
    "date": "CSS selector for the date column (REQUIRED)",
    "hares": "CSS selector or null",
    "location": "CSS selector or null",
    "locationUrl": "CSS selector for element with href to map or null",
    "title": "CSS selector or null",
    "runNumber": "CSS selector or null",
    "startTime": "CSS selector or null",
    "kennelTag": "CSS selector or null",
    "sourceUrl": "CSS selector for element with href or null"
  },
  "defaultKennelTag": "best guess kennel abbreviation from the data (e.g., 'DFWH3')",
  "dateLocale": "en-US or en-GB based on date format",
  "confidence": "high, medium, or low",
  "explanation": "brief explanation of what you found"
}

Only output the JSON object, no other text.`;
}

/** Parse Gemini response into column config. */
export function parseGeminiResponse(text: string): {
  columns: Partial<GenericHtmlColumns>;
  defaultKennelTag: string;
  dateLocale: "en-US" | "en-GB";
  confidence: "high" | "medium" | "low";
  explanation: string;
} | null {
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```json?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(cleaned);

    // Sanitize selectors — strip any dangerous content
    const sanitize = (val: unknown): string | undefined => {
      if (typeof val !== "string" || !val.trim()) return undefined;
      if (/<script|javascript:|on\w+\s*=/i.test(val)) return undefined;
      return val.trim();
    };

    // Date selector is required — reject if AI didn't provide a valid one
    const dateSelector = sanitize(parsed.columns?.date);
    if (!dateSelector) return null;

    const columns: Partial<GenericHtmlColumns> = {
      date: dateSelector,
    };
    if (parsed.columns.hares) columns.hares = sanitize(parsed.columns.hares);
    if (parsed.columns.location) columns.location = sanitize(parsed.columns.location);
    if (parsed.columns.locationUrl) columns.locationUrl = sanitize(parsed.columns.locationUrl);
    if (parsed.columns.title) columns.title = sanitize(parsed.columns.title);
    if (parsed.columns.runNumber) columns.runNumber = sanitize(parsed.columns.runNumber);
    if (parsed.columns.startTime) columns.startTime = sanitize(parsed.columns.startTime);
    if (parsed.columns.kennelTag) columns.kennelTag = sanitize(parsed.columns.kennelTag);
    if (parsed.columns.sourceUrl) columns.sourceUrl = sanitize(parsed.columns.sourceUrl);

    return {
      columns,
      defaultKennelTag: typeof parsed.defaultKennelTag === "string" ? parsed.defaultKennelTag : "UNKNOWN",
      dateLocale: parsed.dateLocale === "en-GB" ? "en-GB" : "en-US",
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
      explanation: typeof parsed.explanation === "string" ? parsed.explanation : "AI analysis complete",
    };
  } catch {
    return null;
  }
}

// ─── Embedded source discovery ───────────────────────────────────────────────

/**
 * Scan fetched HTML for embedded source URLs (Google Calendar, iCal, Sheets, Meetup).
 * Returns deduplicated list of discovered URLs.
 */
export function discoverEmbeddedSources($: CheerioAPI): string[] {
  const urls = new Set<string>();

  // Links: <a href="calendar.google.com/...">
  $('a[href*="calendar.google.com"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) urls.add(href);
  });

  // Iframes: <iframe src="calendar.google.com/...">
  $('iframe[src*="calendar.google.com"]').each((_, el) => {
    const src = $(el).attr("src");
    if (src) urls.add(src);
  });

  // iCal feeds: .ics links and webcal:// links
  $('a[href$=".ics"], a[href*="webcal://"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) urls.add(href);
  });

  // Google Sheets links
  $('a[href*="docs.google.com/spreadsheets"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) urls.add(href);
  });

  // Meetup links
  $('a[href*="meetup.com"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) urls.add(href);
  });

  // Script tag scanning: look for calendar.google.com URLs in inline JS/JSON
  $("script").each((_, el) => {
    const text = $(el).html();
    if (!text || !text.includes("calendar.google.com")) return;
    const calRegex = /https?:\/\/calendar\.google\.com\/calendar\/embed\?[^\s"'<>]+/g;
    const matches = text.match(calRegex);
    if (matches) {
      // Decode HTML entities (Cheerio .html() may return &amp; for &)
      for (const m of matches) urls.add(he.decode(m));
    }
  });

  return [...urls];
}

// ─── Core functions (no auth required) ───────────────────────────────────────

/** Empty error result — reused across early returns. */
function errorResult(error: string, explanation = ""): HtmlAnalysisResult {
  return { candidates: [], suggestedConfig: null, explanation, confidence: null, error };
}

/** Build config from parsed Gemini response + candidate. */
function buildConfig(
  parsed: NonNullable<ReturnType<typeof parseGeminiResponse>>,
  candidate: ContainerCandidate,
  containerOverride?: string,
  rowOverride?: string,
): GenericHtmlConfig {
  return {
    containerSelector: containerOverride ?? candidate.containerSelector,
    rowSelector: rowOverride ?? candidate.rowSelector,
    columns: {
      date: parsed.columns.date!,
      ...Object.fromEntries(
        Object.entries(parsed.columns).filter(([k, v]) => k !== "date" && v),
      ),
    } as GenericHtmlColumns,
    defaultKennelTag: parsed.defaultKennelTag,
    dateLocale: parsed.dateLocale,
  };
}

/** Validate URL, fetch page, and find candidate containers. Shared by analyze and refine. */
async function fetchAndFindContainers(
  url: string,
): Promise<{ candidates: ContainerCandidate[]; $: CheerioAPI } | { error: HtmlAnalysisResult }> {
  if (!url.trim()) return { error: errorResult("URL required") };

  try { validateSourceUrl(url); } catch (e) {
    return { error: errorResult(e instanceof Error ? e.message : "Invalid URL") };
  }

  const page = await fetchHTMLPage(url);
  if (!page.ok) {
    const msg = page.result.errors[0] || "Failed to fetch page";
    return { error: errorResult(msg, msg) };
  }

  const candidates = findCandidateContainers(page.$);
  if (candidates.length === 0) {
    // Even without containers, scan for embedded sources
    const embeddedUrls = discoverEmbeddedSources(page.$);
    return {
      error: {
        candidates: [],
        suggestedConfig: null,
        explanation: "No event-like containers found on this page. The page may use JavaScript rendering (not supported) or have an unusual layout.",
        confidence: null,
        embeddedUrls: embeddedUrls.length > 0 ? embeddedUrls : undefined,
      },
    };
  }

  return { candidates, $: page.$ };
}

/**
 * Analyze an HTML page for event containers and suggest a GenericHtmlConfig.
 * No auth required — suitable for batch pipeline use.
 */
export async function analyzeUrlForProposal(url: string): Promise<HtmlAnalysisResult> {
  const fetched = await fetchAndFindContainers(url);
  if ("error" in fetched) return fetched.error;

  const { candidates, $ } = fetched;
  const bestCandidate = candidates[0];

  // Discover embedded sources (Calendar links, iCal feeds, etc.)
  const embeddedUrls = discoverEmbeddedSources($);

  // Try Gemini for column mapping
  const prompt = buildAnalysisPrompt(bestCandidate, bestCandidate.layoutType);
  const geminiResult = await callGemini({ prompt, maxOutputTokens: 2048 }, 0);

  if (!geminiResult.text) {
    return {
      candidates,
      suggestedConfig: null,
      explanation: geminiResult.error
        ? `Found ${candidates.length} candidate container(s), but AI analysis unavailable: ${geminiResult.error}.`
        : `Found ${candidates.length} candidate container(s). Configure column selectors manually.`,
      confidence: null,
      embeddedUrls: embeddedUrls.length > 0 ? embeddedUrls : undefined,
    };
  }

  const parsed = parseGeminiResponse(geminiResult.text);
  if (!parsed) {
    return {
      candidates,
      suggestedConfig: null,
      explanation: "AI returned an unparseable response.",
      confidence: null,
      embeddedUrls: embeddedUrls.length > 0 ? embeddedUrls : undefined,
    };
  }

  return {
    candidates,
    suggestedConfig: buildConfig(parsed, bestCandidate),
    explanation: parsed.explanation,
    confidence: parsed.confidence,
    embeddedUrls: embeddedUrls.length > 0 ? embeddedUrls : undefined,
  };
}

/**
 * Refine analysis with admin feedback/corrections.
 * No auth required — suitable for server action delegation.
 */
export async function refineAnalysis(
  url: string,
  currentConfig: Partial<GenericHtmlConfig>,
  feedback: string,
): Promise<HtmlAnalysisResult> {
  const fetched = await fetchAndFindContainers(url);
  if ("error" in fetched) return fetched.error;

  const { candidates } = fetched;
  const bestCandidate = candidates[0];
  const examples = getExamplesForLayout(bestCandidate.layoutType);
  const examplesText = formatExamplesForPrompt(examples);

  const rowsText = bestCandidate.sampleRows
    .map((row, i) => `  Row ${i}: ${JSON.stringify(row)}`)
    .join("\n");

  const currentConfigText = currentConfig.columns
    ? Object.entries(currentConfig.columns)
        .filter(([, v]) => v)
        .map(([k, v]) => `  ${k}: "${v}"`)
        .join("\n")
    : "  (none)";

  const prompt = `You are refining an HTML event table analysis based on admin feedback.

Reference examples:
${examplesText}

Page data (${bestCandidate.layoutType} layout):
Container: "${bestCandidate.containerSelector}" → Row: "${bestCandidate.rowSelector}"
Sample rows:
${rowsText}

Current column mapping:
${currentConfigText}

Admin feedback: "${feedback}"

Adjust the column mappings based on the admin's feedback. Respond with the same JSON format:
{
  "columns": { "date": "...", "hares": "...", ... },
  "defaultKennelTag": "...",
  "dateLocale": "en-US or en-GB",
  "confidence": "high/medium/low",
  "explanation": "what changed based on feedback"
}

Only output the JSON object, no other text.`;

  const geminiResult = await callGemini({ prompt, maxOutputTokens: 2048 }, 0);

  if (!geminiResult.text) {
    return {
      candidates,
      suggestedConfig: null,
      explanation: geminiResult.error || "AI refinement failed",
      confidence: null,
    };
  }

  const parsed = parseGeminiResponse(geminiResult.text);
  if (!parsed) {
    return {
      candidates,
      suggestedConfig: null,
      explanation: "AI returned unparseable response during refinement",
      confidence: null,
    };
  }

  return {
    candidates,
    suggestedConfig: buildConfig(
      parsed,
      bestCandidate,
      currentConfig.containerSelector,
      currentConfig.rowSelector,
    ),
    explanation: parsed.explanation,
    confidence: parsed.confidence,
  };
}
