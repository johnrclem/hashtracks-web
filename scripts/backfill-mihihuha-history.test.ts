import { describe, it, expect } from "vitest";
import { filterHandEditedMihiHuHa } from "./backfill-mihihuha-history";
import type { RawEventData } from "@/adapters/types";

function ev(over: Partial<RawEventData>): RawEventData {
  return {
    date: "2017-06-01",
    kennelTags: ["mihi-huha"],
    ...over,
  } as RawEventData;
}

describe("filterHandEditedMihiHuHa", () => {
  it("keeps a 2017 hand-edited event with explicit #N", () => {
    const kept = ev({ date: "2017-06-15", runNumber: 80, title: "MiHiHuHa #80" });
    expect(filterHandEditedMihiHuHa([kept])).toEqual([kept]);
  });

  it("keeps a 2016 hand-edited event with theme separator (':')", () => {
    const kept = ev({ date: "2016-04-13", title: "MiHiHuHa: Chip and Dale" });
    expect(filterHandEditedMihiHuHa([kept])).toEqual([kept]);
  });

  it("keeps a 2016 event with theme separator (' - ')", () => {
    const kept = ev({ date: "2016-08-03", title: "Mile High Humpin' Hash - Cream of Tuna" });
    expect(filterHandEditedMihiHuHa([kept])).toEqual([kept]);
  });

  it("drops a phantom-titled 2017 event even when hares are present (phantom check wins)", () => {
    const dropped = ev({ date: "2017-08-12", title: "Mile High Humpin' Hash", hares: "Fist Deep" });
    // Bareness is checked BEFORE the positive-signal check — a phantom-title
    // row is always noise, even if hare data was attached by mistake.
    expect(filterHandEditedMihiHuHa([dropped])).toEqual([]);
  });

  it("keeps a 2017 event with hares + a non-phantom bare title variant", () => {
    const kept = ev({ date: "2017-08-12", title: "MiHiHuHa Annual Trail", hares: "Tainted Glove" });
    expect(filterHandEditedMihiHuHa([kept])).toEqual([kept]);
  });

  it("keeps a 2017 event with only location set", () => {
    const kept = ev({ date: "2017-09-01", title: "Some other title", location: "Lions Park, Golden, CO" });
    expect(filterHandEditedMihiHuHa([kept])).toEqual([kept]);
  });

  it("drops a 2017 event that is bare phantom title + nothing else", () => {
    const noise = ev({ date: "2017-06-15", title: "Mile High Humpin' Hash" });
    expect(filterHandEditedMihiHuHa([noise])).toEqual([]);
  });

  it("drops the bare RRULE-phantom title 'MiHiHuHa'", () => {
    const noise = ev({ date: "2017-06-15", title: "MiHiHuHa" });
    expect(filterHandEditedMihiHuHa([noise])).toEqual([]);
  });

  it("drops a 2017 event with non-phantom title but no positive signal (fail-closed)", () => {
    const ambiguous = ev({ date: "2017-06-15", title: "Mystery 2017 entry" });
    expect(filterHandEditedMihiHuHa([ambiguous])).toEqual([]);
  });

  it("ignores leading/trailing whitespace when matching phantom titles", () => {
    const noise = ev({ date: "2017-06-15", title: "  Mile High Humpin' Hash  " });
    expect(filterHandEditedMihiHuHa([noise])).toEqual([]);
  });

  it("drops a 2023 event (outside hand-edited era) even with run number", () => {
    const recent = ev({ date: "2023-04-05", runNumber: 432, title: "MiHiHuHa #432" });
    expect(filterHandEditedMihiHuHa([recent])).toEqual([]);
  });

  it("drops a 2015 event (before hand-edited era)", () => {
    const tooOld = ev({ date: "2015-12-31", runNumber: 46, title: "MiHiHuHa #46" });
    expect(filterHandEditedMihiHuHa([tooOld])).toEqual([]);
  });

  it("keeps boundary dates (Jan 1 2016 and Dec 31 2018)", () => {
    const lower = ev({ date: "2016-01-01", runNumber: 47, title: "MiHiHuHa #47" });
    const upper = ev({ date: "2018-12-31", runNumber: 160, title: "MiHiHuHa #160" });
    expect(filterHandEditedMihiHuHa([lower, upper])).toEqual([lower, upper]);
  });
});
