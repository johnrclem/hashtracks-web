import { describe, it, expect } from "vitest";
import { parseHogtownEvents } from "./hogtown";

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
});
