import { describe, it, expect } from "vitest";
import { isPlaceholderCell, parseHrsTime } from "./legacy-frontpage-utils";

describe("parseHrsTime", () => {
  it.each([
    ["11:00Hrs", "11:00"],
    ["19:30", "19:30"],
    ["Noon", "12:00"],
    ["7pm", "19:00"],
    ["7:00pm", "19:00"],
    ["7:30 PM", "19:30"],
    ["12:15am", "00:15"],
    ["12pm", "12:00"],
    ["12am", "00:00"],
    ["11 AM", "11:00"],
  ])("%s -> %s", (input, expected) => {
    expect(parseHrsTime(input)).toBe(expected);
  });

  it.each([undefined, "", "TBC", "25:00", "13pm", "0am"])("rejects %s", (input) => {
    expect(parseHrsTime(input)).toBeUndefined();
  });
});

describe("isPlaceholderCell", () => {
  it("treats stacked placeholder phrases and blanks as placeholders", () => {
    expect(isPlaceholderCell("TBC Limited Numbers")).toBe(true);
    expect(isPlaceholderCell("Hares Required")).toBe(true);
    expect(isPlaceholderCell(undefined)).toBe(true);
  });

  it("keeps real values", () => {
    expect(isPlaceholderCell("The Engineers")).toBe(false);
  });
});
