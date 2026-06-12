import { computeYearsActive } from "./KennelStats";

// Use the real current year so the test never ages out (#1290 + relative-date rule).
const CURRENT_YEAR = new Date().getUTCFullYear();
const utcNoon = (year: number) =>
  new Date(Date.UTC(year, 0, 1, 12, 0, 0)).toISOString();

describe("computeYearsActive (#1290)", () => {
  it("uses foundedYear as an exact (non-approximate) figure", () => {
    const result = computeYearsActive(CURRENT_YEAR - 10, utcNoon(CURRENT_YEAR - 2));
    expect(result).toEqual({
      years: 10,
      sinceYear: CURRENT_YEAR - 10,
      approximate: false,
    });
  });

  it("falls back to earliest known run as an approximate lower bound when foundedYear is null", () => {
    const result = computeYearsActive(null, utcNoon(CURRENT_YEAR - 3));
    expect(result).toEqual({
      years: 3,
      sinceYear: CURRENT_YEAR - 3,
      approximate: true,
    });
  });

  it("returns null when there is no founding year and no event history (tile suppressed)", () => {
    expect(computeYearsActive(null, null)).toBeNull();
    expect(computeYearsActive(undefined, null)).toBeNull();
  });

  it("returns 0 years when the only known run is the current year (renderer then suppresses)", () => {
    const result = computeYearsActive(null, utcNoon(CURRENT_YEAR));
    expect(result).toEqual({ years: 0, sinceYear: CURRENT_YEAR, approximate: true });
  });

  it("prefers foundedYear over event history when both are present", () => {
    const result = computeYearsActive(CURRENT_YEAR - 25, utcNoon(CURRENT_YEAR - 1));
    expect(result?.sinceYear).toBe(CURRENT_YEAR - 25);
    expect(result?.approximate).toBe(false);
  });

  it("is pure when given an explicit currentYear (deterministic, no clock dependency)", () => {
    expect(computeYearsActive(1990, null, 2026)).toEqual({
      years: 36,
      sinceYear: 1990,
      approximate: false,
    });
    expect(computeYearsActive(null, utcNoon(2020), 2026)).toEqual({
      years: 6,
      sinceYear: 2020,
      approximate: true,
    });
  });
});
