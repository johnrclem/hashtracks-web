import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callGemini, clearGeminiCache } from "./gemini";

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
    expect(capturedUrl).toContain("gemini-2.0-flash");
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
});
