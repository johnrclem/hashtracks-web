import { describe, it, expect } from "vitest";
import { parseColomboHarriettesPage } from "./colombo-harriettes";

const SOURCE_URL = "https://hashcolombo.com/";
// Fixed reference date so year-less rollover (if ever hit) stays deterministic.
const NOW = new Date("2026-06-15T00:00:00Z");

/**
 * Build the home page around a "Next run" block body. Mirrors the live DOM
 * captured 2026-06-22: the heading <p> carries the `bg-ch-light-yellow` class
 * and its sibling content sits in the SAME parent <div>. A decoy "Thinking of
 * Joining the Fun?" block shares that yellow class to prove detection keys on
 * the heading TEXT, not the CSS class.
 */
function wrap(body: string): string {
  return `<!DOCTYPE html><html><head><title>Colombo Hash House Harriettes</title></head><body>
<header><a href="/about">About</a></header>
<p class="text-4xl font-extrabold">Where the trail ends, the fun begins!</p>
<section class="bg-white"><div class="mx-auto max-w-6xl px-6 py-12"><div class="sm:flex lg:flex-row"><div>
<p class="
      bg-ch-light-yellow p-5 text-4xl
      font-extrabold text-black
      sm:text-center
      sm:text-6xl __className_70d0d8
      lg:whitespace-nowrap
    ">Next run</p>${body}
</div></div></div></section>
<div class="mx-auto mt-2 h-1 w-2/3 border-b border-black"></div>
<section class="bg-white"><div class="mx-auto max-w-6xl px-6 py-4"><div><div>
<p class="bg-ch-light-yellow p-5 text-4xl font-extrabold text-black sm:text-center sm:text-6xl __className_70d0d8">Thinking of Joining the Fun?</p>
<p class="mt-5 pl-7 text-2xl font-light text-black">Joining us is easy! Drop us a line.</p>
</div></div></section>
<footer><a href="https://colombohash.com">ColomboHash</a></footer>
</body></html>`;
}

// Live placeholder DOM, verbatim (2026-06-22): the between-postings state.
const PLACEHOLDER = wrap(
  `<p class="mt-5 pl-7 text-2xl font-light text-black">We will announce soon</p>`,
);

// Constructed filled state from the documented Run #2223 sample. The exact
// element shape the committee uses is unconfirmed (the live site was in the
// placeholder state at onboarding); these <p>s + the embed iframe sit in the
// heading's parent <div>, which is what the parser reads.
const FILLED = wrap(`
<p class="mt-5 pl-7 text-2xl font-light text-black">Run #2223</p>
<p class="text-2xl">2026-06-20</p>
<p class="text-2xl">KK's Crib</p>
<p class="text-2xl">17:00</p>
<p class="text-2xl">No.5, 1st Cross Street, Kandawala Road, Ratmalana</p>
<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3960!2d79.8861!3d6.8211!2m3!1f0!2f0!3f0" loading="lazy"></iframe>`);

describe("parseColomboHarriettesPage", () => {
  it("returns 0 events / no errors for the between-postings placeholder", () => {
    const { events, errors } = parseColomboHarriettesPage(PLACEHOLDER, SOURCE_URL, NOW);
    expect(events).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("parses a filled run block into one event", () => {
    const { events, errors } = parseColomboHarriettesPage(FILLED, SOURCE_URL, NOW);
    expect(errors).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      date: "2026-06-20",
      runNumber: 2223,
      startTime: "17:00",
      location: "KK's Crib",
      locationStreet: "No.5, 1st Cross Street, Kandawala Road, Ratmalana",
      latitude: 6.8211,
      longitude: 79.8861,
      kennelTags: ["colombo-harriettes"],
      sourceUrl: SOURCE_URL,
    });
    expect(events[0].locationUrl).toContain("google.com/maps/embed");
  });

  it("leaves title undefined so merge.ts synthesizes 'Colombo Harriettes Trail #N'", () => {
    const { events } = parseColomboHarriettesPage(FILLED, SOURCE_URL, NOW);
    expect(events[0].title).toBeUndefined();
    // never synthesize hares from the venue / run header
    expect(events[0].hares).toBeUndefined();
  });

  it("converts a 12-hour start time ('5:00 PM' → '17:00')", () => {
    const html = FILLED.replace(">17:00<", ">5:00 PM<");
    const { events } = parseColomboHarriettesPage(html, SOURCE_URL, NOW);
    expect(events[0].startTime).toBe("17:00");
  });

  it("ignores an out-of-Sri-Lanka embed pin but keeps the map URL", () => {
    // A default/garbage pin (lng 0, lat 0) must not become per-event coords.
    const html = FILLED.replace("!2d79.8861!3d6.8211", "!2d0!3d0");
    const { events } = parseColomboHarriettesPage(html, SOURCE_URL, NOW);
    expect(events[0].latitude).toBeUndefined();
    expect(events[0].longitude).toBeUndefined();
    expect(events[0].locationUrl).toContain("google.com/maps/embed");
  });

  it("fails loud when the 'Next run' heading is missing (markup drift)", () => {
    const { events, errors } = parseColomboHarriettesPage(
      "<html><body><p>Welcome to the Colombo Harriettes</p></body></html>",
      SOURCE_URL,
      NOW,
    );
    expect(events).toEqual([]);
    expect(errors[0]).toMatch(/heading not found/i);
  });

  it("fails loud when the block is neither the placeholder nor a parseable run", () => {
    const html = wrap(`<p class="mt-5 pl-7">Check our Facebook page for trail details.</p>`);
    const { events, errors } = parseColomboHarriettesPage(html, SOURCE_URL, NOW);
    expect(events).toEqual([]);
    expect(errors[0]).toMatch(/neither the known placeholder nor a parseable run/i);
  });

  it("fails loud when a run is present but the date will not parse", () => {
    const html = wrap(`
<p class="mt-5 pl-7">Run #2224</p>
<p class="text-2xl">Venue TBA</p>
<p class="text-2xl">5:00 PM</p>`);
    const { events, errors } = parseColomboHarriettesPage(html, SOURCE_URL, NOW);
    expect(events).toEqual([]);
    expect(errors[0]).toMatch(/could not parse a date/i);
  });
});
