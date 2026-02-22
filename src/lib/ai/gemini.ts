/**
 * Gemini REST API client — thin wrapper for structured extraction.
 *
 * Uses the REST API directly (no SDK dependency) per PRD Appendix E.1.
 * Model: gemini-2.0-flash (fast, cheap — ideal for structured extraction).
 * Temperature: 0.1 (deterministic for reproducible results).
 */

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiRequest {
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface GeminiResponse {
  text: string | null;
  error?: string;
  durationMs: number;
}

/**
 * Call the Gemini API for structured text extraction.
 * Returns null text + error string if the API is unavailable or fails.
 */
export async function callGemini(request: GeminiRequest): Promise<GeminiResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { text: null, error: "GEMINI_API_KEY not configured", durationMs: 0 };
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

    return { text, durationMs };
  } catch (err) {
    return {
      text: null,
      error: `Gemini request failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }
}
