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
        partialData: { kennelTag: "OFH3" },
      },
    ];

    const result = await attemptAiRecovery(errors, "OFH3");
    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].recovered.date).toBe("2026-03-14");
    expect(result.results[0].recovered.kennelTag).toBe("OFH3");
    expect(result.results[0].recovered.hares).toBe("Just John");
    expect(result.results[0].recovered.location).toBe("Blue Heron Elementary");
    expect(result.results[0].confidence).toBe("high");
    expect(result.results[0].fieldsRecovered).toContain("date");
    expect(result.results[0].fieldsRecovered).toContain("hares");
    expect(result.results[0].fieldsRecovered).toContain("location");
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
          kennelTag: "OFH3",
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
        partialData: { kennelTag: "OFH3", title: "March Trail" },
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
    expect(result.results[0].recovered.kennelTag).toBe("TestH3");
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
