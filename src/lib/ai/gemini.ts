/**
 * Gemini REST API client — thin wrapper for structured extraction.
 *
 * Uses the REST API directly (no SDK dependency) per PRD Appendix E.1.
 * Model: gemini-2.5-flash-lite (fast, cheapest — ideal for structured extraction).
 * Temperature: 0.1 (deterministic for reproducible results).
 *
 * Also provides `searchWithGemini()` for search-grounded research queries
 * using gemini-2.0-flash (required for google_search tool).
 */

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_SEARCH_MODEL = "gemini-2.0-flash";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Simple in-memory response cache (survives within a single server instance). */
const responseCache = new Map<string, { response: GeminiResponse; expiresAt: number }>();
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_ENTRIES = 100;

/** Build a deterministic cache key from the full request parameters. */
function buildCacheKey(request: GeminiRequest): string {
  return JSON.stringify({
    prompt: request.prompt,
    temperature: request.temperature ?? 0.1,
    maxOutputTokens: request.maxOutputTokens ?? 4096,
  });
}

/** Evict expired entries and enforce max size (oldest-first). */
function pruneCache(): void {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (entry.expiresAt <= now) {
      responseCache.delete(key);
    }
  }
  // If still over limit, evict oldest entries (Map iterates in insertion order)
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const firstKey = responseCache.keys().next().value;
    if (firstKey !== undefined) responseCache.delete(firstKey);
    else break;
  }
}

/** Clear the in-memory response cache. Exported for test isolation. */
export function clearGeminiCache(): void {
  responseCache.clear();
}

/** Request parameters for `callGemini()`. */
export interface GeminiRequest {
  /** The full prompt text sent to Gemini (including any structured extraction instructions). */
  prompt: string;
  /** Max output tokens (default 4096). */
  maxOutputTokens?: number;
  /** Sampling temperature (default 0.1 for deterministic extraction). */
  temperature?: number;
}

/** Response from `callGemini()`. Check `text` for null and `error` for failure details. */
export interface GeminiResponse {
  /** Raw JSON text from the model, or null if the call failed. */
  text: string | null;
  /** Error message if the API was unavailable, returned non-200, or produced empty output. */
  error?: string;
  /** Wall-clock duration of the API call in milliseconds. */
  durationMs: number;
}

/**
 * Call the Gemini API for structured text extraction.
 * Returns null text + error string if the API is unavailable or fails.
 * @param cacheTtlMs - Optional cache TTL in ms (default 1 hour). Set to 0 to skip caching.
 */
export async function callGemini(request: GeminiRequest, cacheTtlMs = DEFAULT_CACHE_TTL_MS): Promise<GeminiResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { text: null, error: "GEMINI_API_KEY not configured", durationMs: 0 };
  }

  // Check cache (keyed on prompt + generation config)
  const cacheKey = buildCacheKey(request);
  if (cacheTtlMs > 0) {
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.response, durationMs: 0 };
    }
    // Evict expired entry on miss
    if (cached) responseCache.delete(cacheKey);
  }

  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: request.prompt }] }],
        generationConfig: {
          temperature: request.temperature ?? 0.1,
          maxOutputTokens: request.maxOutputTokens ?? 4096,
          responseMimeType: "application/json",
        },
      }),
    });

    const durationMs = Date.now() - start;

    if (!response.ok) {
      if (response.status === 429) {
        return {
          text: null,
          error: "Rate limit exceeded — try again in a few minutes",
          durationMs,
        };
      }
      const body = await response.text();
      return {
        text: null,
        error: `Gemini API ${response.status}: ${body.slice(0, 200)}`,
        durationMs,
      };
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text =
      parts
        .filter((p: Record<string, unknown>) => typeof p?.text === "string")
        .map((p: Record<string, unknown>) => p.text as string)
        .join("\n")
        .trim() || null;

    if (!text) {
      return {
        text: null,
        error: "Gemini returned empty response",
        durationMs,
      };
    }

    const result: GeminiResponse = { text, durationMs };
    if (cacheTtlMs > 0) {
      responseCache.set(cacheKey, { response: result, expiresAt: Date.now() + cacheTtlMs });
      pruneCache();
    }
    return result;
  } catch (err) {
    return {
      text: null,
      error: `Gemini request failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}

// ─── Two-step search + extract ───────────────────────────────────────────────

/**
 * Two-step search-and-extract: grounded web search → JSON extraction.
 *
 * Step 1: `searchWithGemini` gets narrative prose + grounding URLs.
 * Step 2: `callGemini` (with JSON mode) extracts structured JSON from the prose.
 *
 * This works around search grounding being incompatible with JSON mode.
 */
export async function searchAndExtract(
  searchPrompt: string,
  extractionPrompt: (searchText: string, groundingUrls: string[]) => string,
  maxSearchTokens = 4096,
): Promise<GeminiSearchResponse> {
  const searchResult = await searchWithGemini(searchPrompt, maxSearchTokens);

  if (!searchResult.text) {
    return searchResult;
  }

  // Step 2: Extract structured JSON from the prose
  const extraction = await callGemini(
    { prompt: extractionPrompt(searchResult.text, searchResult.groundingUrls) },
    0, // no caching — search results are time-sensitive
  );

  return {
    text: extraction.text,
    groundingUrls: searchResult.groundingUrls,
    error: extraction.error,
    durationMs: searchResult.durationMs + extraction.durationMs,
  };
}

// ─── Search-grounded Gemini ──────────────────────────────────────────────────

/** Response from `searchWithGemini()`. */
export interface GeminiSearchResponse {
  /** Natural text from the model, or null on failure. */
  text: string | null;
  /** URLs extracted from groundingMetadata.groundingChunks[].web.uri */
  groundingUrls: string[];
  /** Error message if the call failed. */
  error?: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

/**
 * Call Gemini with Google Search grounding enabled.
 *
 * Uses `gemini-2.0-flash` (search grounding requires it, not compatible with lite).
 * No `responseMimeType` (search grounding is incompatible with JSON mode).
 * No caching (search results are time-sensitive).
 * Temperature: 0.3 (slightly creative for research queries).
 */
export async function searchWithGemini(
  prompt: string,
  maxOutputTokens = 4096,
): Promise<GeminiSearchResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { text: null, groundingUrls: [], error: "GEMINI_API_KEY not configured", durationMs: 0 };
  }

  const url = `${GEMINI_BASE_URL}/${GEMINI_SEARCH_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens,
        },
      }),
    });

    const durationMs = Date.now() - start;

    if (!response.ok) {
      if (response.status === 429) {
        return {
          text: null,
          groundingUrls: [],
          error: "Rate limit exceeded — try again in a few minutes",
          durationMs,
        };
      }
      const body = await response.text();
      return {
        text: null,
        groundingUrls: [],
        error: `Gemini API ${response.status}: ${body.slice(0, 200)}`,
        durationMs,
      };
    }

    const data = await response.json();
    const textParts = data?.candidates?.[0]?.content?.parts ?? [];
    const text =
      textParts
        .filter((p: Record<string, unknown>) => typeof p?.text === "string")
        .map((p: Record<string, unknown>) => p.text as string)
        .join("\n")
        .trim() || null;

    // Extract grounding URLs from metadata
    const groundingChunks =
      data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const groundingUrls: string[] = [];
    for (const chunk of groundingChunks) {
      const uri = chunk?.web?.uri;
      if (typeof uri === "string" && uri.startsWith("http")) {
        groundingUrls.push(uri);
      }
    }

    return { text, groundingUrls, durationMs };
  } catch (err) {
    return {
      text: null,
      groundingUrls: [],
      error: `Gemini search failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}
