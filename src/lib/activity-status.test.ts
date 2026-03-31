import { getActivityStatus } from "@/lib/activity-status";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

describe("getActivityStatus", () => {
  it("returns 'unknown' for null", () => {
    expect(getActivityStatus(null)).toBe("unknown");
  });

  it("returns 'active' for event 0 days ago (today)", () => {
    expect(getActivityStatus(daysAgo(0))).toBe("active");
  });

  it("returns 'active' for event 89 days ago", () => {
    expect(getActivityStatus(daysAgo(89))).toBe("active");
  });

  it("returns 'possibly-inactive' for event 90 days ago", () => {
    expect(getActivityStatus(daysAgo(90))).toBe("possibly-inactive");
  });

  it("returns 'possibly-inactive' for event 91 days ago", () => {
    expect(getActivityStatus(daysAgo(91))).toBe("possibly-inactive");
  });

  it("returns 'possibly-inactive' for event 364 days ago", () => {
    expect(getActivityStatus(daysAgo(364))).toBe("possibly-inactive");
  });

  it("returns 'inactive' for event 365 days ago", () => {
    expect(getActivityStatus(daysAgo(365))).toBe("inactive");
  });

  it("returns 'inactive' for event 366 days ago", () => {
    expect(getActivityStatus(daysAgo(366))).toBe("inactive");
  });

  it("returns 'active' for future dates", () => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 30);
    expect(getActivityStatus(future)).toBe("active");
  });

  describe("hasUpcomingEvent override", () => {
    it("returns 'active' when hasUpcomingEvent is true and lastEventDate is null", () => {
      expect(getActivityStatus(null, true)).toBe("active");
    });

    it("returns 'active' when hasUpcomingEvent is true and lastEventDate is stale", () => {
      expect(getActivityStatus(daysAgo(400), true)).toBe("active");
    });

    it("preserves existing behavior when hasUpcomingEvent is false", () => {
      expect(getActivityStatus(null, false)).toBe("unknown");
      expect(getActivityStatus(daysAgo(400), false)).toBe("inactive");
    });

    it("preserves existing behavior when hasUpcomingEvent is omitted", () => {
      expect(getActivityStatus(null)).toBe("unknown");
      expect(getActivityStatus(daysAgo(400))).toBe("inactive");
    });
  });
});
