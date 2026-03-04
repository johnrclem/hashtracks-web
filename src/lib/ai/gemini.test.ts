import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callGemini, clearGeminiCache, searchWithGemini, searchAndExtract } from "./gemini";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  clearGeminiCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

describe("callGemini", () => {
  it("returns error when GEMINI_API_KEY is not set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const result = await callGemini({ prompt: "test" });
    expect(result.text).toBeNull();
    expect(result.error).toBe("GEMINI_API_KEY not configured");
    expect(result.durationMs).toBe(0);
  });

  it("sends correct request structure", async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"date": "2026-03-14"}' }] } }],
      }));
    });

    await callGemini({ prompt: "Extract date", temperature: 0.2, maxOutputTokens: 1024 });

    const body = JSON.parse(capturedBody!);
    expect(body.contents[0].parts[0].text).toBe("Extract date");
    expect(body.generationConfig.temperature).toBe(0.2);
    expect(body.generationConfig.maxOutputTokens).toBe(1024);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("includes API key in URL", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "{}" }] } }],
      }));
    });

    await callGemini({ prompt: "test" });
    expect(capturedUrl).toContain("key=test-key");
    expect(capturedUrl).toContain("gemini-2.5-flash-lite");
  });

  it("returns parsed text on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"date": "2026-03-14"}' }] } }],
      })),
    );

    const result = await callGemini({ prompt: "test" });
    expect(result.text).toBe('{"date": "2026-03-14"}');
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns friendly error on 429 rate limit", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Rate limited", { status: 429 }),
    );

    const result = await callGemini({ prompt: "test-429" });
    expect(result.text).toBeNull();
    expect(result.error).toBe("Rate limit exceeded — try again in a few minutes");
  });

  it("returns error on other HTTP failures", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    const result = await callGemini({ prompt: "test-500" });
    expect(result.text).toBeNull();
    expect(result.error).toContain("Gemini API 500");
  });

  it("returns error on network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await callGemini({ prompt: "test" });
    expect(result.text).toBeNull();
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns error when response has no candidates", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] })),
    );

    const result = await callGemini({ prompt: "test" });
    expect(result.text).toBeNull();
    expect(result.error).toBe("Gemini returned empty response");
  });

  it("uses default temperature and maxOutputTokens", async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "{}" }] } }],
      }));
    });

    await callGemini({ prompt: "test" });

    const body = JSON.parse(capturedBody!);
    expect(body.generationConfig.temperature).toBe(0.1);
    expect(body.generationConfig.maxOutputTokens).toBe(4096);
  });

  it("returns cached response on repeated calls", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"cached": true}' }] } }],
      }));
    });

    const first = await callGemini({ prompt: "cache-test" });
    const second = await callGemini({ prompt: "cache-test" });

    expect(fetchCount).toBe(1);
    expect(second.text).toBe(first.text);
    expect(second.durationMs).toBe(0);
  });

  it("uses separate cache entries for different generation config", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: `{"call": ${fetchCount}}` }] } }],
      }));
    });

    await callGemini({ prompt: "same-prompt", temperature: 0.1 });
    await callGemini({ prompt: "same-prompt", temperature: 0.9 });

    expect(fetchCount).toBe(2);
  });

  it("concatenates multiple text parts in response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { text: "Some preamble text" },
              { text: '{"date": "2026-03-14"}' },
            ],
          },
        }],
      })),
    );

    const result = await callGemini({ prompt: "test" });
    expect(result.text).toBe('Some preamble text\n{"date": "2026-03-14"}');
    expect(result.error).toBeUndefined();
  });

  it("skips non-text parts when concatenating", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { text: '{"result": true}' },
              { functionCall: { name: "search", args: {} } },
              { text: "extra" },
            ],
          },
        }],
      })),
    );

    const result = await callGemini({ prompt: "test" });
    expect(result.text).toBe('{"result": true}\nextra');
  });

  it("skips cache when cacheTtlMs is 0", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "{}" }] } }],
      }));
    });

    await callGemini({ prompt: "no-cache" }, 0);
    await callGemini({ prompt: "no-cache" }, 0);

    expect(fetchCount).toBe(2);
  });
});

describe("searchWithGemini", () => {
  it("returns error when GEMINI_API_KEY is not set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const result = await searchWithGemini("test");
    expect(result.text).toBeNull();
    expect(result.groundingUrls).toEqual([]);
    expect(result.error).toBe("GEMINI_API_KEY not configured");
  });

  it("uses gemini-2.0-flash model with google_search tool", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body as string;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "result" }] } }],
      }));
    });

    await searchWithGemini("find hash kennels");

    expect(capturedUrl).toContain("gemini-2.0-flash");
    const body = JSON.parse(capturedBody!);
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.generationConfig.temperature).toBe(0.3);
    expect(body.generationConfig.responseMimeType).toBeUndefined();
  });

  it("extracts grounding URLs from metadata", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: "Found results" }] },
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://example.com/page1", title: "Page 1" } },
              { web: { uri: "https://example.com/page2", title: "Page 2" } },
            ],
          },
        }],
      })),
    );

    const result = await searchWithGemini("test");
    expect(result.text).toBe("Found results");
    expect(result.groundingUrls).toEqual([
      "https://example.com/page1",
      "https://example.com/page2",
    ]);
  });

  it("returns empty groundingUrls when no metadata", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "no grounding" }] } }],
      })),
    );

    const result = await searchWithGemini("test");
    expect(result.text).toBe("no grounding");
    expect(result.groundingUrls).toEqual([]);
  });

  it("returns friendly error on 429 rate limit", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Rate limited", { status: 429 }),
    );

    const result = await searchWithGemini("test");
    expect(result.text).toBeNull();
    expect(result.groundingUrls).toEqual([]);
    expect(result.error).toBe("Rate limit exceeded — try again in a few minutes");
  });

  it("handles network errors gracefully", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await searchWithGemini("test");
    expect(result.text).toBeNull();
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("concatenates multiple text parts in response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { text: "Let me search for hash kennels..." },
              { text: '[{"fullName": "Garden State H3", "shortName": "GSH3"}]' },
            ],
          },
          groundingMetadata: { groundingChunks: [] },
        }],
      })),
    );

    const result = await searchWithGemini("find NJ kennels");
    expect(result.text).toBe(
      'Let me search for hash kennels...\n[{"fullName": "Garden State H3", "shortName": "GSH3"}]',
    );
    expect(result.error).toBeUndefined();
  });

  it("skips non-text parts (e.g. function calls) when concatenating", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { functionCall: { name: "google_search", args: {} } },
              { text: "search results here" },
            ],
          },
        }],
      })),
    );

    const result = await searchWithGemini("test");
    expect(result.text).toBe("search results here");
  });

  it("filters out invalid grounding URIs", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: "results" }] },
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: "https://valid.com" } },
              { web: { uri: "" } },
              { web: {} },
              { other: { data: "ignored" } },
            ],
          },
        }],
      })),
    );

    const result = await searchWithGemini("test");
    expect(result.groundingUrls).toEqual(["https://valid.com"]);
  });
});

describe("searchAndExtract", () => {
  it("performs two-step search then extraction", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      if (callCount === 1) {
        // Search call (gemini-2.0-flash) — returns prose
        expect(url).toContain("gemini-2.0-flash");
        return new Response(JSON.stringify({
          candidates: [{
            content: { parts: [{ text: "I found Garden State H3 (GSH3) in New Jersey and Princeton H3 (PH3) in Princeton." }] },
            groundingMetadata: {
              groundingChunks: [{ web: { uri: "https://gsh3.com" } }],
            },
          }],
        }));
      }
      // Extraction call (gemini-2.5-flash-lite) — returns JSON
      expect(url).toContain("gemini-2.5-flash-lite");
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: '[{"fullName":"Garden State H3","shortName":"GSH3"},{"fullName":"Princeton H3","shortName":"PH3"}]' }] },
        }],
      }));
    });

    const result = await searchAndExtract(
      "Find NJ kennels",
      (text) => `Extract JSON from: ${text}`,
    );

    expect(callCount).toBe(2);
    expect(result.text).toContain("GSH3");
    expect(result.groundingUrls).toEqual(["https://gsh3.com"]);
    expect(result.error).toBeUndefined();
  });

  it("returns search error when search step fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Rate limited", { status: 429 }),
    );

    const result = await searchAndExtract(
      "search prompt",
      (text) => `extract: ${text}`,
    );

    expect(result.text).toBeNull();
    expect(result.error).toContain("Rate limit");
    expect(result.groundingUrls).toEqual([]);
  });

  it("returns extraction error when extraction step fails", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: "prose text" }] } }],
        }));
      }
      return new Response("Server error", { status: 500 });
    });

    const result = await searchAndExtract(
      "search",
      (text) => `extract: ${text}`,
    );

    expect(result.text).toBeNull();
    expect(result.error).toContain("Gemini API 500");
    // Grounding URLs from search step still returned
    expect(result.groundingUrls).toEqual([]);
  });

  it("passes search text and grounding URLs to extraction prompt builder", async () => {
    let extractionPrompt: string | undefined;
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({
          candidates: [{
            content: { parts: [{ text: "Found kennel X" }] },
            groundingMetadata: {
              groundingChunks: [{ web: { uri: "https://x.com" } }],
            },
          }],
        }));
      }
      extractionPrompt = JSON.parse(init.body as string).contents[0].parts[0].text;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "[]" }] } }],
      }));
    });

    await searchAndExtract(
      "search",
      (text, urls) => `Text: ${text}, URLs: ${urls.join(",")}`,
    );

    expect(extractionPrompt).toBe("Text: Found kennel X, URLs: https://x.com");
  });
});
