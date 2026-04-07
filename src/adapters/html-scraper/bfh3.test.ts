import { describe, it, expect } from "vitest";
import { parseBfh3DateList } from "./bfh3";

describe("parseBfh3DateList", () => {
  it("parses the date-hour list into date + startTime pairs", () => {
    const input = `
2026-01-03T19
2026-01-10T15
2026-01-24T15

2026-02-02T19
2026-02-08T12
    `;
    const parsed = parseBfh3DateList(input);
    expect(parsed).toEqual([
      { date: "2026-01-03", startTime: "19:00" },
      { date: "2026-01-10", startTime: "15:00" },
      { date: "2026-01-24", startTime: "15:00" },
      { date: "2026-02-02", startTime: "19:00" },
      { date: "2026-02-08", startTime: "12:00" },
    ]);
  });

  it("pads single-digit hours", () => {
    expect(parseBfh3DateList("2026-03-07T9")).toEqual([
      { date: "2026-03-07", startTime: "09:00" },
    ]);
  });

  it("skips malformed lines without throwing", () => {
    const input = `
2026-01-03T19
not a date
2026-02-02
2026-02-08T12
`;
    expect(parseBfh3DateList(input)).toEqual([
      { date: "2026-01-03", startTime: "19:00" },
      { date: "2026-02-08", startTime: "12:00" },
    ]);
  });
});
