import { computeFillRates } from "./fill-rates";
import { buildRawEvent } from "@/test/factories";

describe("computeFillRates", () => {
  it("returns all zeros for empty array", () => {
    const result = computeFillRates([]);
    expect(result).toEqual({
      title: 0,
      location: 0,
      hares: 0,
      startTime: 0,
      runNumber: 0,
    });
  });

  it("returns all 100 when all fields present", () => {
    const events = [
      buildRawEvent(),
      buildRawEvent({ runNumber: 2101, title: "Another Trail" }),
    ];
    const result = computeFillRates(events);
    expect(result).toEqual({
      title: 100,
      location: 100,
      hares: 100,
      startTime: 100,
      runNumber: 100,
    });
  });

  it("computes correct percentages for mixed fill", () => {
    const events = [
      buildRawEvent(),
      buildRawEvent({ location: undefined, hares: undefined, startTime: undefined }),
    ];
    const result = computeFillRates(events);
    expect(result.title).toBe(100);
    expect(result.location).toBe(50);
    expect(result.hares).toBe(50);
    expect(result.startTime).toBe(50);
    expect(result.runNumber).toBe(100);
  });

  it("treats runNumber: 0 as present (not null)", () => {
    const events = [buildRawEvent({ runNumber: 0 })];
    const result = computeFillRates(events);
    expect(result.runNumber).toBe(100);
  });

  it("treats runNumber: null/undefined as missing", () => {
    const events = [buildRawEvent({ runNumber: undefined })];
    const result = computeFillRates(events);
    expect(result.runNumber).toBe(0);
  });

  it("treats empty string title as falsy (0% fill)", () => {
    const events = [buildRawEvent({ title: "" })];
    const result = computeFillRates(events);
    expect(result.title).toBe(0);
  });

  it("rounds correctly for non-integer percentages", () => {
    // 1 out of 3 = 33.33... → 33
    const events = [
      buildRawEvent({ location: "Place" }),
      buildRawEvent({ location: undefined }),
      buildRawEvent({ location: undefined }),
    ];
    const result = computeFillRates(events);
    expect(result.location).toBe(33);

    // 2 out of 3 = 66.67 → 67
    const events2 = [
      buildRawEvent({ location: "Place" }),
      buildRawEvent({ location: "Place 2" }),
      buildRawEvent({ location: undefined }),
    ];
    const result2 = computeFillRates(events2);
    expect(result2.location).toBe(67);
  });
});
