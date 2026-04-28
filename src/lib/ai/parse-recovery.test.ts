import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./gemini", () => ({
  callGemini: vi.fn(),
}));

import { callGemini } from "./gemini";
import { attemptAiRecovery, isAiRecoveryAvailable } from "./parse-recovery";
import type { ParseError } from "@/adapters/types";

const mockCallGemini = vi.mocked(callGemini);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAiRecoveryAvailable", () => {
  it("returns false when GEMINI_API_KEY is not set", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(isAiRecoveryAvailable()).toBe(false);
  });

  it("returns true when GEMINI_API_KEY is set", () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    expect(isAiRecoveryAvailable()).toBe(true);
  });
});

describe("attemptAiRecovery", () => {
  it("returns empty summary when no errors have rawText", async () => {
    const errors: ParseError[] = [
      { row: 0, error: "No date found", field: "date" },
    ];

    const result = await attemptAiRecovery(errors, "OFH3");
    expect(result.attempted).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toEqual([]);
    expect(mockCallGemini).not.toHaveBeenCalled();
  });

  it("returns empty summary when rawText is empty", async () => {
    const errors: ParseError[] = [
      { row: 0, error: "No date found", field: "date", rawText: "   " },
    ];

    const result = await attemptAiRecovery(errors, "OFH3");
    expect(result.attempted).toBe(0);
    expect(mockCallGemini).not.toHaveBeenCalled();
  });

  it("recovers event from raw text using Gemini", async () => {
    mockCallGemini.mockResolvedValue({
      text: JSON.stringify({
        date: "2026-03-14",
        hares: "Just John",
        location: "Blue Heron Elementary",
        startTime: "11:00",
        confidence: "high",
      }),
      durationMs: 500,
    });

    const errors: ParseError[] = [
      {
        row: 0,
        section: "post",
        field: "date",
        error: "No date found in post: March Trail 3.14.26",
        rawText: "Title: March Trail 3.14.26\n\nHares: Just John\nWhen: 3.14.26\nWhere: Blue Heron Elementary",
        partialData: { kennelTags: ["OFH3" ]},
      },
    ];

    const result = await attemptAiRecovery(errors, "OFH3");
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].recovered.date).toBe("2026-03-14");
    expect(result.results[0].recovered.kennelTags[0]).toBe("OFH3");
    expect(result.results[0].recovered.hares).toBe("Just John");
    expect(result.results[0].recovered.location).toBe("Blue Heron Elementary");
    expect(result.results[0].confidence).toBe("high");
    expect(result.results[0].fieldsRecovered).toContain("date");
    expect(result.results[0].fieldsRecovered).toContain("hares");
    expect(result.results[0].fieldsRecovered).toContain("location");
  });

  it("prefers partialData.kennelTag over the scrape-wide default", async () => {
    // Multi-kennel sources (HASHREGO, SFH3) have parse errors that belong to
    // different kennels in the same scrape. The function-arg `kennelTag` is a
    // single scrape-wide fallback; per-error identity must come from
    // partialData.kennelTag, otherwise recovered events get attached to
    // whichever kennel happened to scrape first.
    mockCallGemini.mockResolvedValue({
      text: JSON.stringify({ date: "2026-04-09", confidence: "high" }),
      durationMs: 100,
    });

    const errors: ParseError[] = [
      {
        row: 0,
        section: "NYCH3",
        error: "bad start_time",
        rawText: "Some raw text",
        partialData: { kennelTags: ["NYCH3" ]},
      },
      {
        row: 0,
        section: "BFMH3",
        error: "bad start_time",
        rawText: "Some raw text",
        partialData: { kennelTags: ["BFMH3" ]},
      },
    ];

    // Pass a misleading default — recovery must IGNORE it because each
    // ParseError has its own partialData.kennelTag.
    const result = await attemptAiRecovery(errors, "WRONG_KENNEL");
    expect(result.succeeded).toBe(2);
    const tags = result.results
      .map((r) => r.recovered.kennelTags[0])
      .sort((a, b) => a.localeCompare(b));
    expect(tags).toEqual(["BFMH3", "NYCH3"]);
  });

  it("preserves partialData.sourceUrl on recovered events (reconcile key)", async () => {
    // Reconcile (src/pipeline/reconcile.ts:52) keys events on
    // (kennelId, date, sourceUrl). If a recovered event drops sourceUrl, it
    // won't match the existing canonical event and the next reconcile pass
    // will cancel that canonical record as stale. Adapters that emit parse
    // errors with a known sourceUrl MUST set partialData.sourceUrl so the
    // recovered event keeps the same reconcile key.
    mockCallGemini.mockResolvedValue({
      text: JSON.stringify({ date: "2026-04-09", confidence: "high" }),
      durationMs: 100,
    });

    const errors: ParseError[] = [
      {
        row: 0,
        section: "NYCH3",
        error: "bad start_time",
        rawText: "Some raw text",
        partialData: {
          kennelTags: ["NYCH3"],
          sourceUrl: "https://hashrego.com/events/nych3-pub-crawl-2026",
        },
      },
    ];

    const result = await attemptAiRecovery(errors, "NYCH3");
    expect(result.succeeded).toBe(1);
    expect(result.results[0].recovered.sourceUrl).toBe(
      "https://hashrego.com/events/nych3-pub-crawl-2026",
    );
  });

  it("uses partialData over AI-extracted fields (deterministic takes priority)", async () => {
    mockCallGemini.mockResolvedValue({
      text: JSON.stringify({
        date: "2026-03-14",
        hares: "AI Hare",
        location: "AI Location",
        confidence: "medium",
      }),
      durationMs: 300,
    });

    const errors: ParseError[] = [
      {
        row: 0,
        field: "date",
        error: "No date",
        rawText: "Some raw text with date 3.14.26",
        partialData: {
          kennelTags: ["OFH3"],
          hares: "Deterministic Hare", // This should take priority over AI
        },
      },
    ];

    const result = await attemptAiRecovery(errors, "OFH3");
    expect(result.succeeded).toBe(1);
    expect(result.results[0].recovered.hares).toBe("Deterministic Hare"); // partialData wins
    expect(result.results[0].recovered.location).toBe("AI Location"); // AI fills gap
  });

  it("counts failed recovery when Gemini returns error", async () => {
    mockCallGemini.mockResolvedValue({
      text: null,
      error: "Rate limited",
      durationMs: 100,
    });

    const errors: ParseError[] = [
      { row: 0, field: "date", error: "No date", rawText: "Some text" },
    ];

    const result = await attemptAiRecovery(errors, "OFH3");
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
  });

  it("counts failed recovery when Gemini returns unparseable JSON", async () => {
    mockCallGemini.mockResolvedValue({
      text: "not json",
      durationMs: 100,
    });

    const errors: ParseError[] = [
      { row: 0, field: "date", error: "No date", rawText: "Some text" },
    ];

    const result = await attemptAiRecovery(errors, "OFH3");
    expect(result.failed).toBe(1);
  });

  it("counts failed recovery when AI cannot extract date (minimum viable event)", async () => {
    mockCallGemini.mockResolvedValue({
      text: JSON.stringify({
        hares: "Just John",
        location: "Some Place",
        confidence: "low",
      }),
      durationMs: 200,
    });

    const errors: ParseError[] = [
      { row: 0, field: "date", error: "No date", rawText: "Some text without date" },
    ];

    const result = await attemptAiRecovery(errors, "OFH3");
    expect(result.failed).toBe(1); // No date = can't create event
  });

  it("handles multiple parse errors in batch", async () => {
    mockCallGemini
      .mockResolvedValueOnce({
        text: JSON.stringify({ date: "2026-03-14", confidence: "high" }),
        durationMs: 300,
      })
      .mockResolvedValueOnce({
        text: null,
        error: "API error",
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({ date: "2026-04-11", hares: "Lucky Dog", confidence: "medium" }),
        durationMs: 400,
      });

    const errors: ParseError[] = [
      { row: 0, field: "date", error: "No date", rawText: "March event 3.14.26" },
      { row: 1, field: "date", error: "No date", rawText: "April event" },
      { row: 2, field: "date", error: "No date", rawText: "April 11 event" },
    ];

    const result = await attemptAiRecovery(errors, "TestH3");
    expect(result.attempted).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results).toHaveLength(2);
  });

  it("validates date format strictly (YYYY-MM-DD)", async () => {
    mockCallGemini.mockResolvedValue({
      text: JSON.stringify({
        date: "March 14, 2026", // Not YYYY-MM-DD format
        confidence: "high",
      }),
      durationMs: 200,
    });

    const errors: ParseError[] = [
      { row: 0, field: "date", error: "No date", rawText: "Some text" },
    ];

    const result = await attemptAiRecovery(errors, "OFH3");
    expect(result.failed).toBe(1); // Invalid date format should be rejected
  });

  it("validates startTime format strictly (HH:MM)", async () => {
    mockCallGemini.mockResolvedValue({
      text: JSON.stringify({
        date: "2026-03-14",
        startTime: "11am", // Not HH:MM format
        confidence: "high",
      }),
      durationMs: 200,
    });

    const errors: ParseError[] = [
      { row: 0, field: "date", error: "No date", rawText: "Some text" },
    ];

    const result = await attemptAiRecovery(errors, "OFH3");
    expect(result.succeeded).toBe(1);
    expect(result.results[0].recovered.startTime).toBeUndefined(); // Invalid format filtered
    expect(result.results[0].fieldsRecovered).not.toContain("startTime");
  });

  it("defaults confidence to low when not provided", async () => {
    mockCallGemini.mockResolvedValue({
      text: JSON.stringify({ date: "2026-03-14" }),
      durationMs: 200,
    });

    const errors: ParseError[] = [
      { row: 0, field: "date", error: "No date", rawText: "Some text" },
    ];

    const result = await attemptAiRecovery(errors, "OFH3");
    expect(result.results[0].confidence).toBe("low");
  });

  it("includes parser context in prompt", async () => {
    let capturedPrompt: string | undefined;
    mockCallGemini.mockImplementation(async (req) => {
      capturedPrompt = req.prompt;
      return { text: JSON.stringify({ date: "2026-03-14", confidence: "high" }), durationMs: 100 };
    });

    const errors: ParseError[] = [
      {
        row: 0,
        field: "date",
        error: "Could not parse date from post: March Trail",
        rawText: "When: 3.14.26\nWhere: School",
        partialData: { kennelTags: ["OFH3"], title: "March Trail" },
      },
    ];

    await attemptAiRecovery(errors, "OFH3");
    expect(capturedPrompt).toContain("date");
    expect(capturedPrompt).toContain("Could not parse date");
    expect(capturedPrompt).toContain("OFH3");
    expect(capturedPrompt).toContain("March Trail");
    expect(capturedPrompt).toContain("3.14.26");
  });

  it("uses kennelTag parameter as default for recovered events", async () => {
    mockCallGemini.mockResolvedValue({
      text: JSON.stringify({ date: "2026-03-14", confidence: "high" }),
      durationMs: 200,
    });

    const errors: ParseError[] = [
      { row: 0, field: "date", error: "No date", rawText: "Some text" },
    ];

    const result = await attemptAiRecovery(errors, "TestH3");
    expect(result.results[0].recovered.kennelTags[0]).toBe("TestH3");
  });

  it("tracks duration across all recovery attempts", async () => {
    mockCallGemini
      .mockResolvedValueOnce({ text: JSON.stringify({ date: "2026-01-01", confidence: "high" }), durationMs: 100 })
      .mockResolvedValueOnce({ text: JSON.stringify({ date: "2026-02-01", confidence: "high" }), durationMs: 200 });

    const errors: ParseError[] = [
      { row: 0, field: "date", error: "No date", rawText: "January event" },
      { row: 1, field: "date", error: "No date", rawText: "February event" },
    ];

    const result = await attemptAiRecovery(errors, "TestH3");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.succeeded).toBe(2);
  });
});
