import { presetDateRange } from "./home-search";

/** Local-time date (month is 1-based), the way the browser builds "today". */
function localDay(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 15, 30);
}

describe("presetDateRange", () => {
  it("covers today and the next six days for 'week'", () => {
    expect(presetDateRange("week", localDay(2026, 11, 11))).toEqual({
      startDate: "2026-11-11",
      endDate: "2026-11-17",
    });
  });

  it("crosses a month and year boundary", () => {
    expect(presetDateRange("week", localDay(2026, 12, 29))).toEqual({
      startDate: "2026-12-29",
      endDate: "2027-01-04",
    });
  });

  it("picks the coming Friday to Sunday on a weekday", () => {
    // Wednesday, Nov 11 2026
    expect(presetDateRange("weekend", localDay(2026, 11, 11))).toEqual({
      startDate: "2026-11-13",
      endDate: "2026-11-15",
    });
    // Monday, Nov 9 2026
    expect(presetDateRange("weekend", localDay(2026, 11, 9))).toEqual({
      startDate: "2026-11-13",
      endDate: "2026-11-15",
    });
  });

  it("starts today once the weekend has begun", () => {
    // Friday, Saturday and Sunday, Nov 13–15 2026
    expect(presetDateRange("weekend", localDay(2026, 11, 13))).toEqual({
      startDate: "2026-11-13",
      endDate: "2026-11-15",
    });
    expect(presetDateRange("weekend", localDay(2026, 11, 14))).toEqual({
      startDate: "2026-11-14",
      endDate: "2026-11-15",
    });
    expect(presetDateRange("weekend", localDay(2026, 11, 15))).toEqual({
      startDate: "2026-11-15",
      endDate: "2026-11-15",
    });
  });
});
