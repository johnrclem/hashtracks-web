import { computeConfigHash } from "./config-hash";

describe("computeConfigHash", () => {
  it("returns identical hashes for objects with reordered keys", () => {
    const a = { calendarId: "x@gmail.com", days: 90, kennelPatterns: { foo: "FOO" } };
    const b = { kennelPatterns: { foo: "FOO" }, days: 90, calendarId: "x@gmail.com" };
    expect(computeConfigHash(a)).toBe(computeConfigHash(b));
  });

  it("returns different hashes when a value changes", () => {
    const a = { selector: "table.past_hashes" };
    const b = { selector: "table.future_hashes" };
    expect(computeConfigHash(a)).not.toBe(computeConfigHash(b));
  });

  it("returns different hashes when a key is added", () => {
    const a = { selector: "table" };
    const b = { selector: "table", upcomingOnly: true };
    expect(computeConfigHash(a)).not.toBe(computeConfigHash(b));
  });

  it("treats null and missing config as the same regime", () => {
    expect(computeConfigHash(null)).toBe(computeConfigHash(undefined));
  });

  it("hashes nested arrays stably regardless of object-key order inside elements", () => {
    const a = { rules: [{ a: 1, b: 2 }, { c: 3 }] };
    const b = { rules: [{ b: 2, a: 1 }, { c: 3 }] };
    expect(computeConfigHash(a)).toBe(computeConfigHash(b));
  });

  it("preserves array order (not sorted) — order is semantically significant", () => {
    const a = { rules: ["a", "b", "c"] };
    const b = { rules: ["c", "b", "a"] };
    expect(computeConfigHash(a)).not.toBe(computeConfigHash(b));
  });
});
