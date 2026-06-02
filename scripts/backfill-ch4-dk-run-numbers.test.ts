import { describe, it, expect } from "vitest";
import { parseCh4TitleRunNumber, planRunNumberBackfill } from "./backfill-ch4-dk-run-numbers";

describe("parseCh4TitleRunNumber", () => {
  it.each([
    ["CH4 376", 376],
    ["CH4 #376", 376],
    ["CH4 352 - Valby St - Deep and Smelly Penetration", 352],
    ["CH4 360 ØB Ølbar - Codpiece, Oeuf, Calapso", 360],
    ["ch4  #260  Gispert", 260],
    // Reject — number not in the leading position (do not guess).
    ["CH4 Full Moon - 315 - Meatloaf Memorial", null],
    ["CH4 Full Moon 318", null],
    ["CH4 run258", null],
    ["CH4 - Flagpole", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])("parses %p -> %p", (title, expected) => {
    expect(parseCh4TitleRunNumber(title)).toBe(expected);
  });
});

describe("planRunNumberBackfill", () => {
  it("sets run numbers on unique, untaken NULL-runNumber events", () => {
    const plan = planRunNumberBackfill([
      { id: "a", title: "CH4 374", runNumber: null },
      { id: "b", title: "CH4 375", runNumber: null },
      { id: "c", title: "CH4 345 - already numbered", runNumber: 345 },
    ]);
    expect(plan.toSet).toEqual([
      { id: "a", number: 374 },
      { id: "b", number: 375 },
    ]);
    expect(plan.skippedCollisions).toEqual([]);
    expect(plan.unparseable).toBe(0);
  });

  it("skips numbers that collide internally (the #352/#360 typo pairs)", () => {
    const plan = planRunNumberBackfill([
      { id: "a", title: "CH4 352 - Carlsberg", runNumber: null },
      { id: "b", title: "CH4 352 - Valby", runNumber: null },
      { id: "c", title: "CH4 360 ØB Ølbar", runNumber: null },
      { id: "d", title: "CH4 360 - Sydhavn", runNumber: null },
      { id: "e", title: "CH4 376", runNumber: null },
    ]);
    expect(plan.toSet).toEqual([{ id: "e", number: 376 }]);
    expect(plan.skippedCollisions).toEqual([352, 360]);
  });

  it("skips a candidate already taken by a non-NULL event", () => {
    const plan = planRunNumberBackfill([
      { id: "a", title: "CH4 345 - dup of existing", runNumber: null },
      { id: "b", title: "CH4 345 - the real one", runNumber: 345 },
    ]);
    expect(plan.toSet).toEqual([]);
    expect(plan.skippedCollisions).toEqual([345]);
  });

  it("counts unparseable titles without setting them", () => {
    const plan = planRunNumberBackfill([
      { id: "a", title: "CH4 - Flagpole", runNumber: null },
      { id: "b", title: "CH4 Full Moon 318", runNumber: null },
      { id: "c", title: "CH4 377", runNumber: null },
    ]);
    expect(plan.toSet).toEqual([{ id: "c", number: 377 }]);
    expect(plan.unparseable).toBe(2);
    expect(plan.skippedCollisions).toEqual([]);
  });
});
