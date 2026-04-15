import { describe, it, expect } from "vitest";
import { parseTravelRedirect } from "./page";

describe("parseTravelRedirect", () => {
  it("returns null for a null redirect", () => {
    expect(parseTravelRedirect(null)).toBeNull();
  });

  it("returns null when the path doesn't start with /travel", () => {
    expect(
      parseTravelRedirect("/hareline?q=Boston&from=2026-04-12&to=2026-04-20"),
    ).toBeNull();
  });

  it("returns null when required params are missing", () => {
    expect(parseTravelRedirect("/travel?from=2026-04-12&to=2026-04-20")).toBeNull();
    expect(parseTravelRedirect("/travel?q=Boston&to=2026-04-20")).toBeNull();
    expect(parseTravelRedirect("/travel?q=Boston&from=2026-04-12")).toBeNull();
  });

  it("extracts destination + dates when /travel params are present", () => {
    expect(
      parseTravelRedirect(
        "/travel?lat=42.3&lng=-71.0&q=Boston%2C+MA%2C+USA&from=2026-04-12&to=2026-04-20",
      ),
    ).toEqual({
      destination: "Boston, MA, USA",
      startDate: "2026-04-12",
      endDate: "2026-04-20",
      isSave: false,
    });
  });

  it("flags isSave when saved=1 is present", () => {
    expect(
      parseTravelRedirect(
        "/travel?q=Boston&from=2026-04-12&to=2026-04-20&saved=1",
      )?.isSave,
    ).toBe(true);
  });

  it("accepts /travel/saved paths (they start with /travel)", () => {
    const out = parseTravelRedirect(
      "/travel/saved?q=Boston&from=2026-04-12&to=2026-04-20",
    );
    expect(out).not.toBeNull();
    expect(out?.destination).toBe("Boston");
  });

  it("returns null for malformed URLs", () => {
    // `new URL` throws on a bare ":" path; the function should swallow.
    expect(parseTravelRedirect(":not a url")).toBeNull();
  });
});
