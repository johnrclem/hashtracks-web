import { inferYearClosestToPublish } from "./year-inference";

describe("inferYearClosestToPublish", () => {
  it("uses the publish year for a date near the publish date", () => {
    expect(inferYearClosestToPublish(20, 7, "2026-07-19T10:00:00Z")).toBe("2026-07-20");
  });

  it("rolls forward across Dec→Jan for an announcement", () => {
    expect(inferYearClosestToPublish(4, 1, "2026-12-30T10:00:00Z")).toBe("2027-01-04");
  });

  it("rolls back for a recap published in January about December", () => {
    expect(inferYearClosestToPublish(28, 12, "2027-01-05T10:00:00Z")).toBe("2026-12-28");
  });

  it("skips years where the date does not exist", () => {
    expect(inferYearClosestToPublish(29, 2, "2027-02-20T10:00:00Z")).toBe("2028-02-29");
  });

  it("returns null for an invalid publish date", () => {
    expect(inferYearClosestToPublish(1, 1, "not-a-date")).toBeNull();
  });
});

describe("inferYearClosestToPublish preferWeekday", () => {
  it("picks the year whose date falls on the stated weekday over a closer one", () => {
    // 4 Dec is a Friday in 2026, a Saturday in 2027. Published mid-2027 the
    // closer year is 2027, but the post says Friday.
    expect(inferYearClosestToPublish(4, 12, "2027-06-20T00:00:00Z", 5)).toBe("2026-12-04");
  });
  it("falls back to the closest year when no candidate matches the weekday", () => {
    expect(inferYearClosestToPublish(4, 12, "2026-11-13T00:00:00Z", 0)).toBe("2026-12-04");
  });
});
