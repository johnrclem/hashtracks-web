import { getTodayUtcNoon, parseUtcNoonDate, toIsoDateString } from "./date";

describe("getTodayUtcNoon", () => {
  it("returns a number (milliseconds timestamp)", () => {
    const result = getTodayUtcNoon();
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });

  it("result corresponds to 12:00:00 UTC today", () => {
    const result = getTodayUtcNoon();
    const date = new Date(result);
    const now = new Date();

    expect(date.getUTCFullYear()).toBe(now.getUTCFullYear());
    expect(date.getUTCMonth()).toBe(now.getUTCMonth());
    expect(date.getUTCDate()).toBe(now.getUTCDate());
  });

  it("hours/minutes/seconds are exactly noon UTC", () => {
    const result = getTodayUtcNoon();
    const date = new Date(result);

    expect(date.getUTCHours()).toBe(12);
    expect(date.getUTCMinutes()).toBe(0);
    expect(date.getUTCSeconds()).toBe(0);
  });
});

describe("parseUtcNoonDate", () => {
  it("parses a valid YYYY-MM-DD string", () => {
    const result = parseUtcNoonDate("2026-02-21");

    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(1); // 0-indexed
    expect(result.getUTCDate()).toBe(21);
  });

  it("sets time to exactly 12:00:00 UTC", () => {
    const result = parseUtcNoonDate("2026-06-15");

    expect(result.getUTCHours()).toBe(12);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });

  it("handles leap year date 2024-02-29", () => {
    const result = parseUtcNoonDate("2024-02-29");

    expect(result.getUTCFullYear()).toBe(2024);
    expect(result.getUTCMonth()).toBe(1);
    expect(result.getUTCDate()).toBe(29);
    expect(result.getUTCHours()).toBe(12);
  });

  it("handles year boundary 2025-12-31", () => {
    const result = parseUtcNoonDate("2025-12-31");

    expect(result.getUTCFullYear()).toBe(2025);
    expect(result.getUTCMonth()).toBe(11);
    expect(result.getUTCDate()).toBe(31);
  });

  it("handles January 1st", () => {
    const result = parseUtcNoonDate("2026-01-01");

    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(0);
    expect(result.getUTCDate()).toBe(1);
  });
});

describe("toIsoDateString", () => {
  it("passes YYYY-MM-DD through unchanged", () => {
    expect(toIsoDateString("2026-04-21")).toBe("2026-04-21");
    expect(toIsoDateString("2026-01-01")).toBe("2026-01-01");
    expect(toIsoDateString("2026-12-31")).toBe("2026-12-31");
  });

  it("extracts the UTC calendar date from a Date", () => {
    expect(toIsoDateString(new Date("2026-04-21T12:00:00Z"))).toBe("2026-04-21");
    expect(toIsoDateString(new Date(Date.UTC(2026, 3, 21, 12, 0, 0)))).toBe("2026-04-21");
  });

  it("strips the time portion from an ISO 8601 timestamp", () => {
    // Protects against adapter leaks — e.g. WordPress API returns
    // "2026-03-29T15:00:00" and a caller forgets to normalize.
    expect(toIsoDateString("2026-03-29T15:00:00Z")).toBe("2026-03-29");
    expect(toIsoDateString("2026-03-29T00:00:00Z")).toBe("2026-03-29");
  });

  it("uses literal-date semantics on offset ISO timestamps (matches parseUtcNoonDate)", () => {
    // Merge's parseUtcNoonDate splits on "-" and parseInts the components,
    // so "2026-04-21T23:30:00-05:00" binds the canonical to April 21. Reconcile
    // MUST key the same way or it would orphan the row merge just wrote.
    expect(toIsoDateString("2026-04-21T23:30:00-05:00")).toBe("2026-04-21");
    expect(toIsoDateString("2026-04-21T23:30:00+09:00")).toBe("2026-04-21");
  });

  it("normalizes overflow dates the same way Date.UTC does (matches merge)", () => {
    // parseUtcNoonDate feeds components into Date.UTC which normalizes overflow.
    // A literal-slice shortcut would key reconcile on "2026-02-31" while merge
    // writes the canonical on "2026-03-03" — an asymmetric mismatch that would
    // cause false cancellation. Round-tripping through parseUtcNoonDate matches.
    expect(toIsoDateString("2026-02-31")).toBe("2026-03-03");
    expect(toIsoDateString("2026-02-31T23:00:00-05:00")).toBe("2026-03-03");
    expect(toIsoDateString("2026-13-01")).toBe("2027-01-01");
  });

  it("throws on empty string", () => {
    expect(() => toIsoDateString("")).toThrow(/Invalid date format/);
  });

  it("accepts merge-compatible loose numeric forms", () => {
    // parseUtcNoonDate splits on "-" and parseInts the components, so merge
    // writes canonicals for "2026-4-1" (no zero-pad) and "2026-02-14 15:00:00"
    // (space-separated time — parseInt stops at the space). Reconcile MUST
    // normalize the same way, or its suppression safeguard would fire and
    // silently disable stale-event cleanup for the kennel — the exact GH #864
    // class of bug this helper exists to prevent.
    expect(toIsoDateString("2026-4-1")).toBe("2026-04-01");
    expect(toIsoDateString("2026-04-1")).toBe("2026-04-01");
    expect(toIsoDateString("2026-02-14 15:00:00")).toBe("2026-02-14");
    expect(toIsoDateString("2026-2-14 15:30")).toBe("2026-02-14");
  });

  it("throws on locale date strings", () => {
    expect(() => toIsoDateString("4/1/2026")).toThrow(/Invalid date format/);
    expect(() => toIsoDateString("April 1, 2026")).toThrow(/Invalid date format/);
  });

  it("throws on Excel serial numbers and other garbage", () => {
    expect(() => toIsoDateString("45321")).toThrow(/Invalid date format/);
    expect(() => toIsoDateString("not-a-date")).toThrow(/Invalid date format/);
  });

  it("accepts ISO-shaped string with garbage time portion (only the date prefix matters)", () => {
    // Literal-date semantics — the time portion is discarded. If an adapter emits
    // a shape-valid but time-garbage ISO string, reconcile still keys on the date
    // prefix the same way merge's parseUtcNoonDate would.
    expect(toIsoDateString("2026-04-21Tfoo")).toBe("2026-04-21");
  });
});
