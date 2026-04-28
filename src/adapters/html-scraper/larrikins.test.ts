import { describe, expect, it } from "vitest";
import { parseLarrikinsDate, parseLarrikinsRow } from "./larrikins";

const URL = "https://sydney.larrikins.org/sydney-south-habour-hhh-tuesday-beers/upcoming-larrikin-runs/";

describe("larrikins parseLarrikinsDate", () => {
  it("parses DD/MM/YYYY (UK)", () => {
    expect(parseLarrikinsDate("21/04/2026")).toBe("2026-04-21");
    expect(parseLarrikinsDate("5/05/2026")).toBe("2026-05-05");
  });

  it("returns null on junk", () => {
    expect(parseLarrikinsDate("")).toBeNull();
    expect(parseLarrikinsDate("April 13 2026")).toBeNull();
  });
});

describe("larrikins parseLarrikinsRow", () => {
  it("parses a full row", () => {
    const e = parseLarrikinsRow("21/04/2026", "2492", "Bejesus", URL);
    expect(e).not.toBeNull();
    expect(e!.date).toBe("2026-04-21");
    expect(e!.runNumber).toBe(2492);
    expect(e!.kennelTags[0]).toBe("larrikins-au");
    expect(e!.hares).toBe("Bejesus");
  });

  it("returns null on missing date", () => {
    expect(parseLarrikinsRow("", "2492", "Bejesus", URL)).toBeNull();
  });

  it("returns null on missing run number", () => {
    expect(parseLarrikinsRow("21/04/2026", "", "Bejesus", URL)).toBeNull();
  });

  it("tolerates missing hare", () => {
    const e = parseLarrikinsRow("21/04/2026", "2492", "", URL);
    expect(e).not.toBeNull();
    expect(e!.hares).toBeUndefined();
  });
});
