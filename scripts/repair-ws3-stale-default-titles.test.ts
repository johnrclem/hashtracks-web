import { describe, expect, it } from "vitest";
import { planTitleRepair } from "./repair-ws3-stale-default-titles";

const larrikins = { kennelCode: "larrikins-au", shortName: "Sydney Larrikins", fullName: null, aliases: [] };
const ch4 = { kennelCode: "ch4-cm", shortName: "CH4", fullName: "Chiang Mai Happy Hash House Harriers", aliases: ["CH4"] };

describe("planTitleRepair", () => {
  it("rebuilds a synthesized default whose number disagrees with the run number", () => {
    expect(planTitleRepair("Sydney Larrikins Trail #2521", 2520, larrikins)).toEqual({
      kind: "wrong-number",
      newTitle: "Sydney Larrikins Trail #2520",
    });
    expect(planTitleRepair("Chiang Mai Happy H3 Trail #1132", 1130, ch4)).toEqual({
      kind: "wrong-number",
      newTitle: "Chiang Mai Happy H3 Trail #1130",
    });
  });

  it("flags a bare default on a numbered run as missing-number", () => {
    expect(planTitleRepair("Sydney Larrikins Trail", 2520, larrikins)).toEqual({
      kind: "missing-number",
      newTitle: "Sydney Larrikins Trail #2520",
    });
  });

  it("leaves a matching default alone", () => {
    expect(planTitleRepair("Sydney Larrikins Trail #2520", 2520, larrikins)).toBeNull();
  });

  it("skips an alias-prefixed default whose number already matches (cosmetic only)", () => {
    expect(planTitleRepair("CH4 Trail #1130", 1130, ch4)).toBeNull();
  });

  it("never touches a real title that merely ends in 'Trail #N'", () => {
    const riyadh = { kennelCode: "riyadh-h3", shortName: "R3H4", fullName: "Riyadh Hash House Harriers", aliases: [] };
    expect(planTitleRepair("Donkey Trail #2", 2499, riyadh)).toBeNull();
    const swh3 = { kennelCode: "swh3", shortName: "SWH3", fullName: "Sir Walter's Hash House Harriers", aliases: [] };
    expect(planTitleRepair("SWH3 Geezer Trail #25", 1812, swh3)).toBeNull();
  });
});
