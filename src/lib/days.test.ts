import { describe, it, expect } from "vitest";
import { SCHEDULE_DAYS, DAY_FULL } from "./days";

describe("SCHEDULE_DAYS", () => {
  it("has 7 entries", () => {
    expect(SCHEDULE_DAYS).toHaveLength(7);
  });

  it("starts with Sun and ends with Sat", () => {
    expect(SCHEDULE_DAYS[0]).toBe("Sun");
    expect(SCHEDULE_DAYS[6]).toBe("Sat");
  });
});

describe("DAY_FULL", () => {
  it("maps all 7 abbreviated days to full names", () => {
    expect(Object.keys(DAY_FULL)).toHaveLength(7);
    expect(DAY_FULL["Mon"]).toBe("Monday");
    expect(DAY_FULL["Tue"]).toBe("Tuesday");
    expect(DAY_FULL["Wed"]).toBe("Wednesday");
    expect(DAY_FULL["Thu"]).toBe("Thursday");
    expect(DAY_FULL["Fri"]).toBe("Friday");
    expect(DAY_FULL["Sat"]).toBe("Saturday");
    expect(DAY_FULL["Sun"]).toBe("Sunday");
  });
});
