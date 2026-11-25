import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSh3Paragraph, parseSh3Paragraphs, Sh3AuAdapter } from "./sh3-au";
import * as safeFetchModule from "../safe-fetch";

const REF = new Date("2026-04-01T12:00:00Z");
const URL = "https://www.sh3.link/?page_id=9470";

describe("sh3-au parseSh3Paragraph", () => {
  it("parses a full block (collapsed innerText)", () => {
    const text =
      "Run #3069Date: 7th April – Tuesday Joint RunHares: HarriettesStart: Carpark 87 Winbourne Rd, Brookvale CLICK HERE FOR MAPOn On: Brookvale Hotel";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    expect(e!.runNumber).toBe(3069);
    expect(e!.date).toBe("2026-04-07");
    expect(e!.kennelTags[0]).toBe("sh3-au");
    expect(e!.hares).toBe("Harriettes");
    expect(e!.location).toBe("Carpark 87 Winbourne Rd, Brookvale");
    expect(e!.description).toBe("Brookvale Hotel");
  });

  it("parses a block missing On On", () => {
    const text = "Run #3070Date: 13th AprilHares: Gilligan & IslandersStart: Chandos St, St Leonards";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    expect(e!.runNumber).toBe(3070);
    expect(e!.date).toBe("2026-04-13");
    expect(e!.hares).toBe("Gilligan & Islanders");
    expect(e!.description).toBeUndefined();
  });

  // Live format (#2360/#2361/#2362): "On On :" carries a space before the
  // colon, the Date cell ends with "@ 6:30pm", and the Start field runs into
  // "CLICK HERE FOR MAP" before the On-On.
  it("handles the live 'On On :' / '@ time' shape: start time, clean location, On-On description", () => {
    const text =
      "Run #3081 Date: 29th June 2026 @ 6:30pm Hares: Beep Beep & Ferret Start: Gordon Station Carpark, off Park Rd, Gordon CLICK HERE FOR MAP On On : Greengate Hotel, Cnr Greengate Rd & Pacific Hwy";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    expect(e!.runNumber).toBe(3081);
    expect(e!.startTime).toBe("18:30");
    expect(e!.hares).toBe("Beep Beep & Ferret");
    // CTA stripped AND On-On no longer leaks into the location.
    expect(e!.location).toBe("Gordon Station Carpark, off Park Rd, Gordon");
    expect(e!.location).not.toMatch(/CLICK HERE/i);
    expect(e!.location).not.toMatch(/Greengate/);
    // On-On captured into description despite the "On On :" space-colon.
    expect(e!.description).toBe("Greengate Hotel, Cnr Greengate Rd & Pacific Hwy");
  });

  it("parses '@ 6:30 pm' and bare '@ 7pm' start times from the Date cell (#2361)", () => {
    expect(
      parseSh3Paragraph("Run #3090 Date: 6th July @ 6:30 pm Hares: X Start: Park", URL, REF)!.startTime,
    ).toBe("18:30");
    expect(
      parseSh3Paragraph("Run #3091 Date: 6th July @ 7pm Hares: X Start: Park", URL, REF)!.startTime,
    ).toBe("19:00");
    // No "@ time" → no start time emitted.
    expect(
      parseSh3Paragraph("Run #3092 Date: 6th July Hares: X Start: Park", URL, REF)!.startTime,
    ).toBeUndefined();
  });

  it("tolerates a 'Start :' label with whitespace before the colon", () => {
    const e = parseSh3Paragraph(
      "Run #3092 Date: 6th July @ 6:30 pm Hares: X Start : Park On On : Pub", URL, REF,
    );
    expect(e!.location).toBe("Park");
    expect(e!.startTime).toBe("18:30");
    expect(e!.description).toBe("Pub");
  });

  it("strips a leading 'Posh –' nickname prefix from hares (#2363)", () => {
    const e = parseSh3Paragraph(
      "Run #3093 Date: 20th July Hares: Posh – Beep Beep & Ferret Start: Park", URL, REF,
    );
    expect(e!.hares).toBe("Beep Beep & Ferret");
    // A hare literally named "Posh" (no separator) survives.
    expect(
      parseSh3Paragraph("Run #3094 Date: 20th July Hares: Posh Start: Park", URL, REF)!.hares,
    ).toBe("Posh");
  });

  it("yields empty hares (not the Start value) when an un-hared run reads 'Hares: Start:' (#2360)", () => {
    const text =
      "Run #3082 Date: 6th July @ 6:30 pm Hares: Start: CLICK HERE FOR MAP On On :";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    expect(e!.hares).toBeUndefined();
    expect(e!.location).toBeNull();
    expect(e!.startTime).toBe("18:30");
  });

  it("returns null when Run # is missing", () => {
    expect(parseSh3Paragraph("Next Few Weeks", URL, REF)).toBeNull();
  });

  it("returns null when Date is unparseable", () => {
    const text = "Run #3071Date: TBCHares: TBA";
    expect(parseSh3Paragraph(text, URL, REF)).toBeNull();
  });

  // #1650 — CLICK HERE FOR MAP appended to locationName (runs #3076, #3077)
  it("strips inline CLICK HERE FOR MAP without eating address suffix (#1650)", () => {
    // Real prod shape: HillsCLICK with no space (text() concatenates the
    // anchor inline), and address detail follows the link.
    const text =
      "Run #3076Date: 25th May @ 6:30pmHares: Your ChoiceStart: Wollundry Park Playground, Yarrara Rd, Pennant HillsCLICK HERE FOR MAP, Pennant Hills, NSWOn On: Pub TBC";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    expect(e!.location).toBe("Wollundry Park Playground, Yarrara Rd, Pennant Hills, Pennant Hills, NSW");
  });

  it("strips trailing CLICK HERE FOR MAP without remaining suffix (#1650)", () => {
    const text =
      "Run #3077Date: 1st JuneHares: SomeoneStart: Forest Hotel Parking Lot, Frenchs Forest RdCLICK HERE FOR MAP";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    expect(e!.location).toBe("Forest Hotel Parking Lot, Frenchs Forest Rd");
  });

  // #1644 — JotForm promo URL bleeds into haresText
  it("strips promotional Tshirt + JotForm URL from hares (#1644)", () => {
    const text =
      "Run #3079Date: 16th JuneHares: Dingo Special Tshirt – order here https://form.jotform.com/261247879266067Start: TBA";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    expect(e!.hares).toBe("Dingo");
  });

  // #2056 — joint-run metadata typed into the Hares field (run #3078). A joint
  // run names the partner kennel + run number + dress code, not trail-setters,
  // so the whole field is dropped rather than stored as a fake hare name.
  it("clears joint-run metadata from hares to null (explicit clear) (#2056)", () => {
    const text =
      "Run #3078Date: 9th JuneHares: Larrikins Joint Run 2500 – wear a tutuStart: St Thomas Rest Park, West St, Crows Nest";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    expect(e!.runNumber).toBe(3078);
    // null, not undefined: an explicit clear that wipes any stale stored hare.
    expect(e!.hares).toBeNull();
  });

  // #1731 — blank Start: lets the non-greedy capture spill into the trailing
  // "CLICK HERE FOR MAP" anchor; the Hares value must NOT become the location.
  it("yields no location when Start: is blank, keeping the Hares value out of locationName (#1731)", () => {
    const text =
      "Run #3085Date: 9th June 2026 @ 6:30pm TUESDAYHares: DingoSpecial Tshirt – order here https://form.jotform.com/261247879266067Start: CLICK HERE FOR MAPOn On:";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    // Start: label present but blank → explicit clear (null), so a venue that
    // disappears between scrapes wipes the stale canonical value (#1731).
    expect(e!.location).toBeNull();
    expect(e!.hares).toBe("Dingo");
  });

  it("strips bare http URL from hares without preceding keyword (#1644)", () => {
    const text =
      "Run #3079Date: 16th JuneHares: Dingo https://example.com/signupStart: TBA";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    expect(e!.hares).toBe("Dingo");
  });

  it("does not over-truncate hares containing harmless promo-shaped words", () => {
    // "Special Sauce" is a plausible hash name; the truncation guard
    // requires a true promo keyword (Tshirt / here) to fire.
    const text =
      "Run #3080Date: 23rd JuneHares: Special SauceStart: Park";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    expect(e!.hares).toBe("Special Sauce");
  });

  it("preserves hash names containing 'T-Shirt' or 'Order' without a promo modifier (#1644)", () => {
    // Bare 'T-shirt' / 'Order' are common in hash nicknames to risk
    // truncating on their own — the guard requires a multi-word promo
    // phrase like 'Special Tshirt' or 'Order here' before chopping.
    expect(parseSh3Paragraph(
      "Run #3081Date: 30th JuneHares: T-Shirt BanditStart: Park", URL, REF,
    )!.hares).toBe("T-Shirt Bandit");
    expect(parseSh3Paragraph(
      "Run #3082Date: 7th JulyHares: OrderStart: Park", URL, REF,
    )!.hares).toBe("Order");
  });

  it("recovers from a false-positive 'click' match and still strips later CLICK HERE FOR MAP (#1702 gemini HIGH)", () => {
    // Pre-fix the cleanStart loop broke on any partial 'click' match
    // (e.g. 'click to enlarge'), terminating before later valid
    // 'CLICK HERE FOR MAP' sentinels could be stripped.
    const text =
      "Run #3083Date: 14th JulyHares: FooStart: Carpark (click to enlarge image) CLICK HERE FOR MAP, Sydney NSW";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    expect(e!.location).toBe("Carpark (click to enlarge image), Sydney NSW");
  });
});

// #2838 / #2848 — the live page dated run #3103 "31st November". chrono fell back
// to the scrape day, so the run landed on Nov 8, then on Nov 9 over run #3100.
describe("sh3-au parseSh3Paragraphs — impossible dates", () => {
  const LIVE = [
    "Run #3100 – A celebrationDate: 9th November @ 6:30pm Hares: Plunger & HandshakeStart: Thornleigh OvalCLICK HERE FOR MAPOn On: On Site",
    "Run #3101Date: 16th November @ 6:30pm Hares: Beep and AlbotrossStart: Acron Oval, St IvesCLICK HERE FOR MAPOn On: On Site",
    "Run #3102Date: 23rd November @ 6:30pm Hares: Music Man & KrusherStart: Little Manly reserve, Stuart St ManlyCLICK HERE FOR MAPOn On: Manly 16 Skiff Club",
    "Run #3103Date: 31st November @ 6:30pm Hares: Khyber & Little ShitStart:Ingleside ScoutsCLICK HERE FOR MAPOn On: On Site",
  ];
  const NOV_8 = new Date("2026-11-08T12:00:00Z");

  it("never files a non-existent day on the scrape date", () => {
    expect(parseSh3Paragraph(LIVE[3], URL, NOV_8)).toBeNull();
  });

  it("dates it from the weekly run sequence and reports the inference", () => {
    const { events, dateInferences, skippedInvalidDates } = parseSh3Paragraphs(LIVE, URL, NOV_8);
    expect(events.map((e) => [e.runNumber, e.date])).toEqual([
      [3100, "2026-11-09"],
      [3101, "2026-11-16"],
      [3102, "2026-11-23"],
      [3103, "2026-11-30"],
    ]);
    expect(events[3]).toMatchObject({ hares: "Khyber & Little Shit", location: "Ingleside Scouts", startTime: "18:30" });
    expect(dateInferences).toEqual([
      'Run #3103: "31st November" is not a real date; filed on 2026-11-30 from run #3102 on 2026-11-23',
    ]);
    expect(skippedInvalidDates).toEqual([]);
  });

  it("skips the run with a warning when the sequence lands outside the stated month", () => {
    const { events, skippedInvalidDates } = parseSh3Paragraphs([LIVE[0], LIVE[3].replace("#3103", "#3109")], URL, NOV_8);
    expect(events.map((e) => e.runNumber)).toEqual([3100]);
    expect(skippedInvalidDates).toHaveLength(1);
  });
});

// Nov 2026: the editors stopped refreshing the page after run #3102, and the
// old forwardDate rule filed the already-run #3100–#3102 a year out (Nov 2027).
// The scrape window dropped them, so the source returned 0 events as a SUCCESS.
describe("sh3-au year inference on a stale page", () => {
  const STALE = [
    "Run #3100 – A celebrationDate: 9th November @ 6:30pm Hares: Plunger & HandshakeStart: Thornleigh OvalCLICK HERE FOR MAPOn On : On Site",
    "Run #3101Date: 16th November @ 6:30pm Hares: Beep and AlbotrossStart: Acron Oval, St IvesCLICK HERE FOR MAPOn On : On Site",
    "Run #3102Date: 23rd November @ 6:30pm Hares: Music Man & KrusherStart: Little Manly reserve, Stuart St ManlyCLICK HERE FOR MAPOn On : Manly 16 Skiff Club",
    "Run #3103Date: 31st November @ 6:30pm Hares: Khyber & Little ShitStart: Ingleside ScoutsCLICK HERE FOR MAPOn On : On Site",
  ];
  const NOV_25 = new Date("2026-11-25T12:00:00Z");

  it("keeps just-run dates in the current year instead of rolling them into next year", () => {
    const { events, skippedInvalidDates } = parseSh3Paragraphs(STALE, URL, NOV_25);
    expect(events.map((e) => [e.runNumber, e.date])).toEqual([
      [3100, "2026-11-09"],
      [3101, "2026-11-16"],
      [3102, "2026-11-23"],
      [3103, "2026-11-30"],
    ]);
    expect(skippedInvalidDates).toEqual([]);
  });

  it("still rolls a January run into next year when read in late December", () => {
    const text = "Run #3110Date: 11th January @ 6:30pm Hares: SomeoneStart: Somewhere";
    expect(parseSh3Paragraph(text, URL, new Date("2026-12-28T12:00:00Z"))?.date).toBe("2027-01-11");
  });

  it("trusts an explicit year in the Date cell", () => {
    const text = "Run #3100Date: 9th November 2026 @ 6:30pm Hares: SomeoneStart: Somewhere";
    expect(parseSh3Paragraph(text, URL, new Date("2027-06-01T12:00:00Z"))?.date).toBe("2026-11-09");
  });
});

describe("Sh3AuAdapter.fetch (live /upcoming-runs/ shape)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const LIVE_HTML = `<html><body><div class="entry clr" itemprop="text">
<p><strong>Next run on 9th November 2026 @ 6:30pm</strong></p>
<p><strong>3100th CELEBRATION</strong><br><strong>Run #3100 – A celebration</strong><br><strong>Date:</strong> 9th November @ 6:30pm<br><strong>Hares:</strong> Plunger &amp; Handshake<br><strong>Start:</strong> Thornleigh Oval<a href="https://maps.app.goo.gl/x">CLICK HERE FOR MAP</a><br><strong>On On :</strong> On Site</p>
<p><strong>Next Few Weeks</strong></p>
<p><strong>Run #3101</strong><br><strong>Date:</strong> 16th November @ 6:30pm<br><strong>Hares:</strong> Beep and Albotross<br><strong>Start:</strong> Acron Oval, St Ives<a href="https://maps.app.goo.gl/y">CLICK HERE FOR MAP</a><br><strong>On On :</strong> On Site</p>
<p><strong>Run #3102</strong><br><strong>Date:</strong> 23rd November @ 6:30pm<br><strong>Hares:</strong> Music Man &amp; Krusher<br><strong>Start:</strong> Little Manly reserve, Stuart St Manly<a href="https://maps.app.goo.gl/z">CLICK HERE FOR MAP</a><br><strong>On On :</strong> Manly 16 Skiff Club</p>
<p><strong>Run #3103</strong><br><strong>Date:</strong> 31st November @ 6:30pm<br><strong>Hares:</strong> Khyber &amp; Little Shit<br><strong>Start:</strong> Ingleside Scouts<a href="https://maps.app.goo.gl/w">CLICK HERE FOR MAP</a><br><strong>On On :</strong> On Site</p>
</div></body></html>`;

  it("returns the stale page's runs in the right year, with the inferred upcoming run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
    vi.spyOn(safeFetchModule, "safeFetch").mockResolvedValueOnce(new Response(LIVE_HTML, { status: 200 }) as never);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await new Sh3AuAdapter().fetch(
      { id: "sh3", url: "https://www.sh3.link/upcoming-runs/", scrapeDays: 180 } as never,
      { days: 180 },
    );

    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => [e.runNumber, e.date])).toEqual([
      [3100, "2026-11-09"],
      [3101, "2026-11-16"],
      [3102, "2026-11-23"],
      [3103, "2026-11-30"],
    ]);
    expect(result.events[3]).toMatchObject({
      kennelTags: ["sh3-au"],
      startTime: "18:30",
      hares: "Khyber & Little Shit",
      location: "Ingleside Scouts",
      description: "On Site",
    });
    expect(result.diagnosticContext).toMatchObject({ eventsParsed: 4, upcomingRunsParsed: 1 });
  });

  it("fails loudly when the page lists no parseable runs", async () => {
    vi.spyOn(safeFetchModule, "safeFetch").mockResolvedValueOnce(
      new Response('<div class="entry clr"><p>Next Few Weeks</p></div>', { status: 200 }) as never,
    );
    const result = await new Sh3AuAdapter().fetch({ id: "sh3", url: "https://www.sh3.link/upcoming-runs/" } as never, { days: 180 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("parsed 0 runs");
  });
});
