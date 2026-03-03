"use server";

import { getAdminUser } from "@/lib/auth";
import { fetchHTMLPage, validateSourceUrl } from "@/adapters/utils";
import { callGemini } from "@/lib/ai/gemini";
import {
  ADAPTER_EXAMPLES,
  getExamplesForLayout,
  formatExamplesForPrompt,
} from "@/adapters/html-scraper/examples";
import type { GenericHtmlConfig, GenericHtmlColumns } from "@/adapters/html-scraper/generic";
import type { CheerioAPI } from "cheerio";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A candidate container found by heuristic analysis. */
export interface ContainerCandidate {
  containerSelector: string;
  rowSelector: string;
  rowCount: number;
  sampleRows: string[][]; // First 5 rows, each row is an array of cell texts
  layoutType: "table" | "div-list" | "unknown";
}

/** Result of AI analysis + heuristic container detection. */
export interface HtmlAnalysisResult {
  candidates: ContainerCandidate[];
  suggestedConfig: GenericHtmlConfig | null;
  explanation: string;
  confidence: "high" | "medium" | "low" | null;
  error?: string;
}

// ─── Date detection ─────────────────────────────────────────────────────────

/** Patterns that suggest a cell contains a date. */
const DATE_PATTERNS = [
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d/i,
  /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/,
  /\b\d{1,2}(?:st|nd|rd|th)\s+\w+/i,
  /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i,
  /\b20\d{2}[\/\-]\d{2}[\/\-]\d{2}\b/, // YYYY-MM-DD
];

function looksLikeDate(text: string): boolean {
  return DATE_PATTERNS.some((p) => p.test(text));
}

// ─── Heuristic container detection ──────────────────────────────────────────

/**
 * Find candidate event containers in an HTML page using heuristics.
 * Looks for tables and repeating div/li structures with date-like content.
 *
 * Exported for unit testing.
 */
export function findCandidateContainers($: CheerioAPI): ContainerCandidate[] {
  const candidates: ContainerCandidate[] = [];

  // Strategy 1: Tables with date-containing rows
  $("table").each((_i, table) => {
    const rows = $(table).find("tr");
    if (rows.length < 3) return; // Too few rows

    let dateRowCount = 0;
    const sampleRows: string[][] = [];

    rows.each((j, row) => {
      const cells = $(row).find("td, th");
      const cellTexts = cells.map((_k, cell) => $(cell).text().trim()).get();
      const rowText = cellTexts.join(" ");

      if (looksLikeDate(rowText)) {
        dateRowCount++;
      }

      if (sampleRows.length < 5 && cellTexts.length > 0) {
        sampleRows.push(cellTexts);
      }
    });

    // At least 30% of rows should contain dates (skip navigation/footer tables)
    if (dateRowCount >= 3 || (dateRowCount / rows.length) > 0.3) {
      // Build a selector for this table
      const tableId = $(table).attr("id");
      const tableClass = $(table).attr("class")?.split(/\s+/)[0];
      const containerSelector = tableId
        ? `#${tableId}`
        : tableClass
          ? `table.${tableClass}`
          : "table";

      // Check if it has tbody
      const hasTbody = $(table).find("tbody").length > 0;
      const rowSelector = hasTbody ? "tbody tr" : "tr";

      candidates.push({
        containerSelector,
        rowSelector,
        rowCount: rows.length,
        sampleRows,
        layoutType: "table",
      });
    }
  });

  // Strategy 2: Repeating div/li with common class and date content
  const classGroups = new Map<string, { elements: ReturnType<typeof $>[]; dateCount: number }>();

  $("div[class], li[class], article[class]").each((_i, el) => {
    const className = $(el).attr("class")?.split(/\s+/)[0];
    if (!className) return;

    const tag = el.type === "tag" ? el.name : "div";
    const key = `${tag}.${className}`;
    const group = classGroups.get(key) ?? { elements: [], dateCount: 0 };
    group.elements.push($(el));
    if (looksLikeDate($(el).text())) {
      group.dateCount++;
    }
    classGroups.set(key, group);
  });

  for (const [selector, { elements, dateCount }] of classGroups) {
    if (elements.length < 3 || dateCount < 2) continue;

    const sampleRows: string[][] = [];
    for (const el of elements.slice(0, 5)) {
      // Extract text from immediate children or notable sub-elements
      const children = el.children();
      if (children.length > 0) {
        const cellTexts = children.map((_j, child) => $(child).text().trim()).get().filter(Boolean);
        if (cellTexts.length > 0) sampleRows.push(cellTexts);
      } else {
        sampleRows.push([el.text().trim()]);
      }
    }

    candidates.push({
      containerSelector: "body",
      rowSelector: selector,
      rowCount: elements.length,
      sampleRows,
      layoutType: "div-list",
    });
  }

  // Sort: most rows with dates first (likely the main event list)
  candidates.sort((a, b) => b.rowCount - a.rowCount);

  return candidates.slice(0, 5);
}

// ─── Gemini column mapping ──────────────────────────────────────────────────

/** Build the Gemini prompt for column mapping. */
function buildAnalysisPrompt(
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
function parseGeminiResponse(text: string): {
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

    if (!parsed.columns?.date) return null;

    // Sanitize selectors — strip any dangerous content
    const sanitize = (val: unknown): string | undefined => {
      if (typeof val !== "string" || !val.trim()) return undefined;
      if (/<script|javascript:|on\w+\s*=/i.test(val)) return undefined;
      return val.trim();
    };

    const columns: Partial<GenericHtmlColumns> = {
      date: sanitize(parsed.columns.date) ?? "td:nth-child(1)",
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

// ─── Main actions ───────────────────────────────────────────────────────────

/**
 * Analyze an HTML page to find event containers and suggest a GenericHtmlConfig.
 * Uses Cheerio heuristics + optional Gemini AI for column mapping.
 */
export async function analyzeHtmlStructure(
  url: string,
): Promise<HtmlAnalysisResult> {
  const admin = await getAdminUser();
  if (!admin) {
    return { candidates: [], suggestedConfig: null, explanation: "", confidence: null, error: "Not authorized" };
  }

  if (!url.trim()) {
    return { candidates: [], suggestedConfig: null, explanation: "", confidence: null, error: "URL required" };
  }

  // SSRF prevention
  try {
    validateSourceUrl(url);
  } catch (e) {
    return {
      candidates: [],
      suggestedConfig: null,
      explanation: "",
      confidence: null,
      error: e instanceof Error ? e.message : "Invalid URL",
    };
  }

  // Fetch the page
  const page = await fetchHTMLPage(url);
  if (!page.ok) {
    const msg = page.result.errors[0] || "Failed to fetch page";
    return { candidates: [], suggestedConfig: null, explanation: msg, confidence: null, error: msg };
  }

  const { $ } = page;

  // Find candidate containers
  const candidates = findCandidateContainers($);

  if (candidates.length === 0) {
    return {
      candidates: [],
      suggestedConfig: null,
      explanation: "No event-like containers found on this page. The page may use JavaScript rendering (not supported) or have an unusual layout.",
      confidence: null,
    };
  }

  // Use the best candidate for AI analysis
  const bestCandidate = candidates[0];

  // Try Gemini for column mapping
  const prompt = buildAnalysisPrompt(bestCandidate, bestCandidate.layoutType);
  const geminiResult = await callGemini({ prompt, maxOutputTokens: 2048 }, 0); // No cache — each URL is unique

  if (!geminiResult.text) {
    // Return candidates without AI mapping (admin can configure manually)
    return {
      candidates,
      suggestedConfig: null,
      explanation: geminiResult.error
        ? `Found ${candidates.length} candidate container(s), but AI analysis unavailable: ${geminiResult.error}. You can configure selectors manually.`
        : `Found ${candidates.length} candidate container(s). Configure column selectors manually.`,
      confidence: null,
    };
  }

  const parsed = parseGeminiResponse(geminiResult.text);

  if (!parsed) {
    return {
      candidates,
      suggestedConfig: null,
      explanation: "AI returned an unparseable response. You can configure selectors manually.",
      confidence: null,
    };
  }

  const suggestedConfig: GenericHtmlConfig = {
    containerSelector: bestCandidate.containerSelector,
    rowSelector: bestCandidate.rowSelector,
    columns: {
      date: parsed.columns.date ?? "td:nth-child(1)",
      ...Object.fromEntries(
        Object.entries(parsed.columns).filter(([k, v]) => k !== "date" && v),
      ),
    } as GenericHtmlColumns,
    defaultKennelTag: parsed.defaultKennelTag,
    dateLocale: parsed.dateLocale,
  };

  return {
    candidates,
    suggestedConfig,
    explanation: parsed.explanation,
    confidence: parsed.confidence,
  };
}

/**
 * Refine AI analysis with admin feedback/corrections.
 * Sends current config + hints back to Gemini for a second pass.
 */
export async function refineHtmlAnalysis(
  url: string,
  currentConfig: Partial<GenericHtmlConfig>,
  feedbackHints: string,
): Promise<HtmlAnalysisResult> {
  const admin = await getAdminUser();
  if (!admin) {
    return { candidates: [], suggestedConfig: null, explanation: "", confidence: null, error: "Not authorized" };
  }

  // SSRF prevention
  try {
    validateSourceUrl(url);
  } catch (e) {
    return {
      candidates: [],
      suggestedConfig: null,
      explanation: "",
      confidence: null,
      error: e instanceof Error ? e.message : "Invalid URL",
    };
  }

  const page = await fetchHTMLPage(url);
  if (!page.ok) {
    const msg = page.result.errors[0] || "Failed to fetch page";
    return { candidates: [], suggestedConfig: null, explanation: msg, confidence: null, error: msg };
  }

  const candidates = findCandidateContainers(page.$);
  if (candidates.length === 0) {
    return { candidates: [], suggestedConfig: null, explanation: "No containers found on re-fetch", confidence: null };
  }

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

Admin feedback: "${feedbackHints}"

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

  const suggestedConfig: GenericHtmlConfig = {
    containerSelector: currentConfig.containerSelector || bestCandidate.containerSelector,
    rowSelector: currentConfig.rowSelector || bestCandidate.rowSelector,
    columns: {
      date: parsed.columns.date ?? "td:nth-child(1)",
      ...Object.fromEntries(
        Object.entries(parsed.columns).filter(([k, v]) => k !== "date" && v),
      ),
    } as GenericHtmlColumns,
    defaultKennelTag: parsed.defaultKennelTag,
    dateLocale: parsed.dateLocale,
  };

  return {
    candidates,
    suggestedConfig,
    explanation: parsed.explanation,
    confidence: parsed.confidence,
  };
}
