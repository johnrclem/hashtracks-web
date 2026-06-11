import {
  parseSsrEvents,
  normalizeRunNumber,
  stripTba,
  ssrEventsToRawEvents,
  type HashrunsSsrBackfillConfig,
} from "./hashruns-ssr-backfill";

// Flight data ships each run as a flat JSON object with `\"`-escaped quotes
// inside `self.__next_f.push([...])`. Build a fixture in that escaped shape so
// the parser's unescape pass is exercised end-to-end.
function escaped(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replaceAll('"', String.raw`\"`);
}

const TITLE_CONFIG: HashrunsSsrBackfillConfig = {
  slug: "PIH3",
  kennelTag: "pih3",
  kennelTimezone: "Europe/Lisbon",
  sourceName: "Porto Invicta H3 Harrier Central",
  titleConfig: {
    defaultTitle: "Porto Invicta H3",
    staleTitleAliases: ["Placeholder event for PIH3"],
  },
};

describe("parseSsrEvents", () => {
  it("parses escaped flight-data objects and dedupes by PublicEventId", () => {
    const e1 = {
      PublicEventId: "id-1",
      EventNumber: 1,
      EventName: "The very first Run",
      EventStartDatetime: "2025-01-04T14:30:00",
      Hares: "Peterfile",
      LocationOneLineDesc: "Jardim do Moro",
    };
    const e2 = {
      PublicEventId: "id-2",
      EventNumber: 2,
      EventStartDatetime: "2025-01-11T14:30:00",
    };
    // e1 appears twice (card + schedule list) — must collapse to one.
    const page = `prefix ${escaped(e1)} mid ${escaped(e1)} ${escaped(e2)} suffix`;
    const events = parseSsrEvents(page);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.EventNumber).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2]);
  });

  it("skips objects without a start datetime and garbled fragments", () => {
    const noDate = escaped({ PublicEventId: "x", EventNumber: 9 });
    const garbled = String.raw`{\"EventNumber\":\"oops`; // truncated → JSON.parse throws
    expect(parseSsrEvents(`${noDate} ${garbled}`)).toHaveLength(0);
  });
});

describe("normalizeRunNumber", () => {
  it.each([
    [5, 5],
    [0, null], // social / drinking practice
    [undefined, undefined],
    [-3, undefined],
  ])("maps %s → %s", (input, expected) => {
    expect(normalizeRunNumber(input as number | undefined)).toBe(expected);
  });
});

describe("stripTba", () => {
  it.each([
    ["Peterfile", "Peterfile"],
    ["  Spaced  ", "Spaced"],
    ["TBA", undefined],
    [" tba ", undefined],
    [undefined, undefined],
    ["", undefined],
  ])("maps %s → %s", (input, expected) => {
    expect(stripTba(input as string | undefined)).toBe(expected);
  });
});

describe("ssrEventsToRawEvents", () => {
  it("maps an SSR event to a RawEventData row with date/time/run/venue", () => {
    const [row] = ssrEventsToRawEvents(
      [
        {
          EventNumber: 1,
          EventName: "The very first Run",
          EventStartDatetime: "2025-01-04T14:30:00",
          Hares: "Peterfile",
          LocationOneLineDesc: "Jardim do Moro",
          Latitude: 41.138,
          Longitude: -8.609,
        },
      ],
      TITLE_CONFIG,
    );
    expect(row).toMatchObject({
      date: "2025-01-04",
      kennelTags: ["pih3"],
      title: "The very first Run",
      runNumber: 1,
      startTime: "14:30",
      hares: "Peterfile",
      location: "Jardim do Moro",
      latitude: 41.138,
      longitude: -8.609,
    });
  });

  it("synthesizes a placeholder title and drops the pin when there is no venue", () => {
    const [row] = ssrEventsToRawEvents(
      [
        {
          EventNumber: 28,
          EventName: "Placeholder event for PIH3",
          EventStartDatetime: "2026-10-07T18:00:00",
          Hares: "TBA",
          Latitude: 41.1,
          Longitude: -8.6,
        },
      ],
      TITLE_CONFIG,
    );
    expect(row.title).toBe("Porto Invicta H3 #28");
    expect(row.hares).toBeUndefined();
    expect(row.location).toBeUndefined();
    // No real venue → coordinates dropped so merge geocodes from text + country.
    expect(row.latitude).toBeUndefined();
    expect(row.longitude).toBeUndefined();
  });
});
