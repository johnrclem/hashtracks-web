import { describe, expect, it } from "vitest";
import { parseThirstyBlock, splitThirstyBlocks } from "./sydney-thirsty-h3";

const REF = new Date("2026-04-01T12:00:00Z");
const URL = "https://www.sth3.org/upcoming-runs";

describe("sydney-thirsty-h3 splitThirstyBlocks", () => {
  it("splits paragraphs on em-dash dividers", () => {
    const blocks = splitThirstyBlocks([
      { text: "Thursday April 9th at 6:30pm" },
      { text: "Run #1842" },
      { text: "Location: Redfern Park, Redfern" },
      { text: "Map: here", href: "https://maps.app.goo.gl/x" },
      { text: "—" },
      { text: "Thursday April 16th at 6:30pm" },
      { text: "Run #1845" },
      { text: "Location: Camperdown Memorial Rest Park" },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveLength(4);
    expect(blocks[1]).toHaveLength(3);
  });
});

describe("sydney-thirsty-h3 parseThirstyBlock", () => {
  it("parses a complete block including Map link", () => {
    const events = parseThirstyBlock(
      [
        { text: "Thursday April 9th at 6:30pm" },
        { text: "Run #1842" },
        { text: "Location: Redfern Park, Redfern" },
        { text: "Map: here", href: "https://maps.app.goo.gl/x" },
      ],
      URL,
      REF,
    );
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.runNumber).toBe(1842);
    expect(e.date).toBe("2026-04-09");
    expect(e.startTime).toBe("18:30");
    expect(e.location).toBe("Redfern Park, Redfern");
    expect(e.locationUrl).toBe("https://maps.app.goo.gl/x");
    expect(e.kennelTags[0]).toBe("sth3-au");
  });

  it("tolerates missing location/map fields", () => {
    const events = parseThirstyBlock(
      [{ text: "Thursday April 23rd at 6:30pm" }, { text: "Run #1846" }, { text: "Location: TBC" }, { text: "Map: TBC" }],
      URL,
      REF,
    );
    expect(events).toHaveLength(1);
    expect(events[0].location).toBeUndefined();
    expect(events[0].locationUrl).toBeUndefined();
  });

  it("tolerates extra description paragraphs (Beer Mile shape)", () => {
    const events = parseThirstyBlock(
      [
        { text: "Saturday 2 May at 2:00pm" },
        { text: "Run #1848" },
        { text: "Sydney's longest running Beer Mile!" },
        { text: "Location: Alexandria Park, Alexandria" },
        { text: "Map: here (South East corner)", href: "https://maps.app.goo.gl/y" },
      ],
      URL,
      REF,
    );
    expect(events).toHaveLength(1);
    expect(events[0].runNumber).toBe(1848);
    expect(events[0].location).toBe("Alexandria Park, Alexandria");
    expect(events[0].locationUrl).toBe("https://maps.app.goo.gl/y");
  });

  it("emits two events for multi-day AGPU-style 'Runs (Sat and Sun) N & M'", () => {
    const events = parseThirstyBlock(
      [
        { text: "Friday, April 10 – Sunday, April 12" },
        { text: "Runs (Sat and Sun) 1843 & 1844" },
        { text: "AGPU in Katoomba" },
        { text: "Join Facebook Group for details" },
      ],
      URL,
      REF,
    );
    expect(events).toHaveLength(2);
    expect(events[0].runNumber).toBe(1843);
    expect(events[1].runNumber).toBe(1844);
    // Both events share the chrono-parsed date from the first line.
    expect(events[0].date).toBe(events[1].date);
  });
});
