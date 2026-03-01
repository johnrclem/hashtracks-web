/**
 * Gemini REST API client — thin wrapper for structured extraction.
 *
 * Uses the REST API directly (no SDK dependency) per PRD Appendix E.1.
 * Model: gemini-2.0-flash (fast, cheap — ideal for structured extraction).
 * Temperature: 0.1 (deterministic for reproducible results).
 */

const GEMINI_MODEL = "gemini-2.0-flash";
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
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

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
