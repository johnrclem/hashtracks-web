import { describe, it, expect } from "vitest";
import { parseHogtownEvents, parseSpecialEventsLocations } from "./hogtown";

/** Minimal fixture mirroring the live Google Sites DOM: each trail entry
 * is a sequence of `<p>` siblings (header, date, hare, location, cost,
 * RSVP url). Three sub-series rotate within one document. */
const FIXTURE = `<html><body>
  <p>Hogtown #2071- GDU Saves the Day!</p>
  <p>Saturday, May 23, 2026, 5pm</p>
  <p>Hare: GDU</p>
  <p>Start Location:  Samara Brewery, 90 Cawthra Ave. A-B trail.</p>
  <p>TTC to Start: Subway line 2 to Keele, bus north to West Toronto Street</p>
  <p>Cost: $10 for drinkers, $2 for non-drinkers</p>
  <p>RSVP here: https://www.meetup.com/meetup-group-pyrddkbc/events/314766795/</p>

  <p>TWAT#582 - Naughty's Birthday Trail</p>
  <p>Thursday, May 28, 2026, 7pm</p>
  <p>Hares: Around the World in Naughty Ways</p>
  <p>Start Location: TBD</p>
  <p>TTC to Start: TBD</p>
  <p>Cost: $10 for drinkers, $2 for non-drinkers</p>
  <p>RSVP here: https://www.meetup.com/meetup-group-pyrddkbc/events/314766800/</p>

  <p>HOGANS #462 - Hareless Hogans</p>
  <p>Friday, June 12, 2026, 7:30pm</p>
  <p>Hares: TBD - Hare needed!</p>
  <p>Start Location: Bloor and Bathurst</p>
  <p>Cost: $15 for drinkers, $2 for non-drinkers</p>
</body></html>`;

describe("parseHogtownEvents", () => {
  it("extracts all three sub-series with rich titles", () => {
    const events = parseHogtownEvents(FIXTURE, "https://www.hogtownh3.com/upcoming-trails");
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.title)).toEqual([
      "HOGTOWN #2071 - GDU Saves the Day!",
      "TWAT #582 - Naughty's Birthday Trail",
      "HOGANS #462 - Hareless Hogans",
    ]);
  });

  it("parses dates and bare-hour start times correctly", () => {
    const events = parseHogtownEvents(FIXTURE, "https://www.hogtownh3.com/upcoming-trails");
    expect(events[0].date).toBe("2026-05-23");
    expect(events[0].startTime).toBe("17:00");
    expect(events[1].date).toBe("2026-05-28");
    expect(events[1].startTime).toBe("19:00");
    expect(events[2].date).toBe("2026-06-12");
    expect(events[2].startTime).toBe("19:30");
  });

  it("parses hares from both 'Hare:' and 'Hares:' label variants", () => {
    const events = parseHogtownEvents(FIXTURE, "https://www.hogtownh3.com/upcoming-trails");
    expect(events[0].hares).toBe("GDU");
    expect(events[1].hares).toBe("Around the World in Naughty Ways");
    expect(events[2].hares).toBe("TBD - Hare needed!");
  });

  it("captures location text and drops TBD placeholders", () => {
    const events = parseHogtownEvents(FIXTURE, "https://www.hogtownh3.com/upcoming-trails");
    expect(events[0].location).toContain("Samara Brewery");
    expect(events[1].location).toBeUndefined(); // TBD → undefined
    expect(events[2].location).toBe("Bloor and Bathurst");
  });

  it("captures cost text", () => {
    const events = parseHogtownEvents(FIXTURE, "https://www.hogtownh3.com/upcoming-trails");
    expect(events[0].cost).toBe("$10 for drinkers, $2 for non-drinkers");
    expect(events[2].cost).toBe("$15 for drinkers, $2 for non-drinkers");
  });

  it("emits the Meetup RSVP link as sourceUrl when present, falling back to the page URL", () => {
    const events = parseHogtownEvents(FIXTURE, "https://www.hogtownh3.com/upcoming-trails");
    expect(events[0].sourceUrl).toBe("https://www.meetup.com/meetup-group-pyrddkbc/events/314766795/");
    expect(events[2].sourceUrl).toBe("https://www.hogtownh3.com/upcoming-trails"); // no RSVP → page fallback
  });

  it("emits kennelTags=['hogtownh3'] regardless of series prefix", () => {
    const events = parseHogtownEvents(FIXTURE, "https://www.hogtownh3.com/upcoming-trails");
    expect(events.every((e) => e.kennelTags.length === 1 && e.kennelTags[0] === "hogtownh3")).toBe(true);
  });

  it("returns empty when no series headers are present", () => {
    const html = `<html><body><p>Welcome to Hogtown</p><p>Runs every other Saturday.</p></body></html>`;
    expect(parseHogtownEvents(html, "https://www.hogtownh3.com/")).toEqual([]);
  });

  it("handles the optional Meetup-ID prefix (e.g. '6795/TWAT#582 - …')", () => {
    const html = `<html><body>
      <p>6795/TWAT#582 - Naughty's Birthday Trail</p>
      <p>Thursday, May 28, 2026, 7pm</p>
      <p>Hare: Naughty</p>
    </body></html>`;
    const events = parseHogtownEvents(html, "https://www.hogtownh3.com/upcoming-trails");
    expect(events).toHaveLength(1);
    expect(events[0].runNumber).toBe(582);
    expect(events[0].title).toBe("TWAT #582 - Naughty's Birthday Trail");
  });
});

// #1932 — campout entries point at the Special Events page for their venue.
// Mirrors the live DOM: a heading carrying the date span + a "Where:" line.
const SPECIAL_EVENTS_FIXTURE = `<html><body>
  <h2>special Events &amp; Announcements</h2>
  <h1>TWAT campouT, 2026 EDITION FriDAY June 19 - Sunday June 21</h1>
  <p>Where: Rock Point Provincial Park, Dunville, Lake Erie Shores</p>
  <p>Cost : $100 for drinkers, $60 for non-drinkers and $40 for kids</p>
  <p>Who's coming?</p>
</body></html>`;

// The /upcoming-trails entry for the campout: no "Start Location:" line, just
// a pointer to the Special Events page.
const CAMPOUT_RUN_LIST_FIXTURE = `<html><body>
  <p>Hogtown #2073 - Special event - TWAT campout!</p>
  <p>Saturday, June 20, 2026</p>
  <p>Details on Special Events Page here</p>
</body></html>`;

describe("parseSpecialEventsLocations", () => {
  it("extracts the venue and the heading's date span", () => {
    const blocks = parseSpecialEventsLocations(SPECIAL_EVENTS_FIXTURE);
    expect(blocks).toEqual([
      {
        location: "Rock Point Provincial Park, Dunville, Lake Erie Shores",
        start: "2026-06-19",
        end: "2026-06-21",
      },
    ]);
  });

  it("ignores headings with no Where/Location paragraph", () => {
    const html = `<html><body><h1>Just an announcement</h1><p>No venue here.</p></body></html>`;
    expect(parseSpecialEventsLocations(html)).toEqual([]);
  });
});

describe("parseHogtownEvents — Special Events enrichment (#1932)", () => {
  it("adopts the campout venue from the Special Events page by date-span containment", () => {
    const special = parseSpecialEventsLocations(SPECIAL_EVENTS_FIXTURE);
    const events = parseHogtownEvents(
      CAMPOUT_RUN_LIST_FIXTURE,
      "https://www.hogtownh3.com/upcoming-trails",
      special,
    );
    expect(events).toHaveLength(1);
    expect(events[0].runNumber).toBe(2073);
    expect(events[0].date).toBe("2026-06-20");
    expect(events[0].location).toBe(
      "Rock Point Provincial Park, Dunville, Lake Erie Shores",
    );
  });

  it("leaves location undefined when no Special Events data is available", () => {
    const events = parseHogtownEvents(
      CAMPOUT_RUN_LIST_FIXTURE,
      "https://www.hogtownh3.com/upcoming-trails",
    );
    expect(events[0].location).toBeUndefined();
  });

  it("does not adopt a venue whose span excludes the entry date when multiple blocks exist", () => {
    const blocks = [
      { location: "Wrong Park", start: "2026-07-01", end: "2026-07-03" },
      { location: "Also Wrong", start: "2026-08-01", end: "2026-08-03" },
    ];
    const events = parseHogtownEvents(
      CAMPOUT_RUN_LIST_FIXTURE,
      "https://www.hogtownh3.com/upcoming-trails",
      blocks,
    );
    expect(events[0].location).toBeUndefined();
  });

  it("does NOT attach a dateless block (no sole-block fallback — avoids a wrong venue)", () => {
    const events = parseHogtownEvents(
      CAMPOUT_RUN_LIST_FIXTURE,
      "https://www.hogtownh3.com/upcoming-trails",
      [{ location: "Rock Point Provincial Park" }],
    );
    expect(events[0].location).toBeUndefined();
  });

  it("drops an absurdly wide / year-crossing span so it can't match unrelated dates", () => {
    // "December 31 - January 2, 2026" both inherit 2026 → sorted span would be
    // 2026-01-02 .. 2026-12-31 (~year). The MAX_SPAN_DAYS guard drops it.
    const html = `<html><body>
      <h1>New Year Campout December 31 - January 2, 2026</h1>
      <p>Where: Somewhere Far Away</p>
    </body></html>`;
    const blocks = parseSpecialEventsLocations(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].start).toBeUndefined();
    expect(blocks[0].end).toBeUndefined();
    // The June campout entry must NOT pick up this venue.
    const events = parseHogtownEvents(
      CAMPOUT_RUN_LIST_FIXTURE,
      "https://www.hogtownh3.com/upcoming-trails",
      blocks,
    );
    expect(events[0].location).toBeUndefined();
  });

  it("ignores an impossible calendar date (e.g. February 30) in a heading", () => {
    const html = `<html><body>
      <h1>Typo Campout February 30, 2026</h1>
      <p>Where: Nowhere</p>
    </body></html>`;
    const blocks = parseSpecialEventsLocations(html);
    expect(blocks[0].start).toBeUndefined();
    expect(blocks[0].end).toBeUndefined();
  });
});
