import { describe, it, expect } from "vitest";
import { KENNELS } from "../prisma/seed-data/kennels";
import { SOURCES } from "../prisma/seed-data/sources";
import { seededKennelCodes } from "./print-seeded-kennel-codes";

describe("seededKennelCodes", () => {
  it("requires a kennel to be both seeded and linked by a source", () => {
    const codes = seededKennelCodes(
      [{ kennelCode: "a" }, { kennelCode: "b" }, { kennelCode: "c" }],
      [{ kennelCodes: ["a", "x"] }, { kennelCodes: ["c"] }, { kennelCodes: undefined }],
    );
    expect(codes).toEqual(["a", "c"]);
  });

  // The two shapes a text grep could not scope correctly (#2673).
  it("resolves identifier-referenced kennelCodes arrays (SFH3 family) from the real seed", () => {
    const sfh3 = SOURCES.find((s) => s.name === "SFH3 MultiHash iCal Feed");
    expect(sfh3).toBeDefined();
    const codes = new Set(seededKennelCodes(KENNELS, SOURCES as never));
    for (const c of (sfh3 as { kennelCodes: string[] }).kennelCodes) expect(codes.has(c)).toBe(true);
  });

  it("does not count a kennelCode that is only quoted outside any kennelCodes array", () => {
    const codes = seededKennelCodes(
      [{ kennelCode: "ghost" }],
      [{ kennelCodes: ["real"], config: { note: "\"ghost\" appears only in this string" } } as never],
    );
    expect(codes).toEqual([]);
  });
});
