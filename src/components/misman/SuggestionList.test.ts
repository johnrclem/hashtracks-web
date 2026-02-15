import { describe, it, expect } from "vitest";
import { getVisibleSuggestions, SuggestionItem } from "./SuggestionList";

function makeSuggestions(count: number): SuggestionItem[] {
  return Array.from({ length: count }, (_, i) => ({
    kennelHasherId: `kh-${i}`,
    hashName: `Hasher ${i}`,
    nerdName: null,
    score: 1 - i * 0.05,
  }));
}

describe("getVisibleSuggestions", () => {
  it("returns all when count is under cap", () => {
    const { visible, hiddenCount } = getVisibleSuggestions(
      makeSuggestions(3),
      new Set(),
    );
    expect(visible).toHaveLength(3);
    expect(hiddenCount).toBe(0);
  });

  it("caps at maxVisible when more are available", () => {
    const { visible, hiddenCount } = getVisibleSuggestions(
      makeSuggestions(15),
      new Set(),
      10,
    );
    expect(visible).toHaveLength(10);
    expect(hiddenCount).toBe(5);
  });

  it("reports correct hiddenCount", () => {
    const { visible, hiddenCount } = getVisibleSuggestions(
      makeSuggestions(20),
      new Set(),
      10,
    );
    expect(visible).toHaveLength(10);
    expect(hiddenCount).toBe(10);
  });

  it("backfills as attended hashers are filtered out", () => {
    const suggestions = makeSuggestions(15);
    const attended = new Set(["kh-0", "kh-1", "kh-2"]);
    const { visible, hiddenCount } = getVisibleSuggestions(
      suggestions,
      attended,
      10,
    );
    // available = kh-3 through kh-14 (12 items), visible = first 10
    expect(visible).toHaveLength(10);
    expect(visible[0].kennelHasherId).toBe("kh-3");
    expect(visible[9].kennelHasherId).toBe("kh-12");
    expect(hiddenCount).toBe(2);
  });

  it("returns empty when all suggestions are attended", () => {
    const suggestions = makeSuggestions(3);
    const attended = new Set(["kh-0", "kh-1", "kh-2"]);
    const { visible, hiddenCount } = getVisibleSuggestions(
      suggestions,
      attended,
    );
    expect(visible).toHaveLength(0);
    expect(hiddenCount).toBe(0);
  });

  it("preserves score ordering (highest first)", () => {
    const suggestions = makeSuggestions(5);
    const { visible } = getVisibleSuggestions(suggestions, new Set());
    for (let i = 1; i < visible.length; i++) {
      expect(visible[i - 1].score).toBeGreaterThanOrEqual(visible[i].score);
    }
  });
});
