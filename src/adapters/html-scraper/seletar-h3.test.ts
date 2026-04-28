import { parseSeletarGps, groupSeletarRows } from "./seletar-h3";

describe("parseSeletarGps", () => {
  it("parses 'lat, lng' with space after comma", () => {
    expect(parseSeletarGps("1.3590246, 103.7525630")).toEqual({
      latitude: 1.3590246,
      longitude: 103.7525630,
    });
  });
  it("parses without space", () => {
    expect(parseSeletarGps("1.42,103.87")).toEqual({ latitude: 1.42, longitude: 103.87 });
  });
  it("returns empty object for null/empty", () => {
    expect(parseSeletarGps(null)).toEqual({});
    expect(parseSeletarGps("")).toEqual({});
    expect(parseSeletarGps(undefined)).toEqual({});
  });
  it("returns empty object for malformed input", () => {
    expect(parseSeletarGps("not gps")).toEqual({});
    expect(parseSeletarGps("1.5")).toEqual({});
  });
});

describe("groupSeletarRows", () => {
  it("groups multiple participant rows into one event per run number", () => {
    const rows = [
      { hl_runno: 2374, hl_datetime: "2026-04-14", hl_runsite: "Bukit Gombak", hl_gps: "1.36, 103.75", hs_type: "H", mb_hashname: "Perut Besar" },
      { hl_runno: 2374, hl_datetime: "2026-04-14", hl_runsite: "Bukit Gombak", hl_gps: "1.36, 103.75", hs_type: "H", mb_hashname: "Skinny" },
      { hl_runno: 2374, hl_datetime: "2026-04-14", hl_runsite: "Bukit Gombak", hl_gps: "1.36, 103.75", hs_type: "S", mb_hashname: "Scribe Sam" },
    ];
    const events = groupSeletarRows(rows).events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      runNumber: 2374,
      date: "2026-04-14",
      kennelTags: ["seletar-h3"],
      startTime: "18:00",
      hares: "Perut Besar, Skinny",
      location: "Bukit Gombak",
      latitude: 1.36,
      longitude: 103.75,
      title: "Seletar H3 Run 2374",
    });
  });

  it("uses hl_comment as title when present", () => {
    const rows = [
      { hl_runno: 2378, hl_datetime: "2026-05-12", hl_runsite: null, hl_gps: null, hl_comment: "Mad Fish happy to be back running", hs_type: "H", mb_hashname: "Mad Fish" },
    ];
    const [event] = groupSeletarRows(rows).events;
    expect(event.title).toBe("Mad Fish happy to be back running");
  });

  it("excludes scribes from the hare list", () => {
    const rows = [
      { hl_runno: 2375, hl_datetime: "2026-04-21", hs_type: "S", mb_hashname: "ScribeOnly" },
    ];
    const [event] = groupSeletarRows(rows).events;
    expect(event.hares).toBeUndefined();
  });

  it("dedupes duplicate hares", () => {
    const rows = [
      { hl_runno: 2376, hl_datetime: "2026-04-28", hs_type: "H", mb_hashname: "Champ" },
      { hl_runno: 2376, hl_datetime: "2026-04-28", hs_type: "H", mb_hashname: "Champ" },
      { hl_runno: 2376, hl_datetime: "2026-04-28", hs_type: "H", mb_hashname: "Goldfinger" },
    ];
    const [event] = groupSeletarRows(rows).events;
    expect(event.hares).toBe("Champ, Goldfinger");
  });

  it("skips rows with no run number or no date and counts the skips", () => {
    const rows = [
      { hl_runno: undefined, hl_datetime: "2026-04-14", hs_type: "H", mb_hashname: "X" },
      { hl_runno: 2377, hl_datetime: undefined, hs_type: "H", mb_hashname: "Y" },
    ];
    const result = groupSeletarRows(rows);
    expect(result.events).toHaveLength(0);
    expect(result.skippedRows).toBe(2);
  });

  it("accepts run #0 (the historical archive includes it)", () => {
    const rows = [
      { hl_runno: 0, hl_datetime: "1980-06-24", hs_type: "H", mb_hashname: "Founder" },
    ];
    const { events } = groupSeletarRows(rows);
    expect(events).toHaveLength(1);
    expect(events[0].runNumber).toBe(0);
    expect(events[0].title).toBe("Seletar H3 Run 0");
  });

  it("sorts events by date ascending", () => {
    const rows = [
      { hl_runno: 2376, hl_datetime: "2026-04-28", hs_type: "H", mb_hashname: "C" },
      { hl_runno: 2374, hl_datetime: "2026-04-14", hs_type: "H", mb_hashname: "A" },
      { hl_runno: 2375, hl_datetime: "2026-04-21", hs_type: "H", mb_hashname: "B" },
    ];
    const dates = groupSeletarRows(rows).events.map((e) => e.date);
    expect(dates).toEqual(["2026-04-14", "2026-04-21", "2026-04-28"]);
  });
});
