import { describe, expect, it } from "vitest";
import { parseAdelaideEvent, parseAdelaideDetail, adelaideWallClockToUnix, stripThemeFromHares } from "./adelaide-h3";

const URL = "https://ah3.com.au/wp-admin/admin-ajax.php";

describe("adelaide-h3 parseAdelaideEvent", () => {
  it("parses a regular run row", () => {
    const e = parseAdelaideEvent(
      {
        id: "690",
        title: "RUN 2645 - Crunchy Crack and Unstoppable",
        start: "2026-04-13 19:00:00",
        end: "2026-04-13 22:00:00",
        className: "cat4",
      },
      URL,
    );
    expect(e).not.toBeNull();
    expect(e!.runNumber).toBe(2645);
    expect(e!.date).toBe("2026-04-13");
    expect(e!.startTime).toBe("19:00");
    expect(e!.kennelTags[0]).toBe("ah3-au");
    expect(e!.hares).toBe("Crunchy Crack and Unstoppable");
  });

  it("parses a milestone variant", () => {
    const e = parseAdelaideEvent(
      { title: "2600th Run!! - Committee", start: "2026-09-07 19:00:00", className: "cat1" },
      URL,
    );
    expect(e).not.toBeNull();
    expect(e!.runNumber).toBe(2600);
    expect(e!.hares).toBe("Committee");
  });

  it("treats TBA as no hares", () => {
    const e = parseAdelaideEvent(
      { title: "RUN 2648 - TBA", start: "2026-05-04 19:00:00" },
      URL,
    );
    expect(e).not.toBeNull();
    expect(e!.hares).toBeUndefined();
  });

  it("returns null on missing title or start", () => {
    expect(parseAdelaideEvent({ start: "2026-04-13 19:00:00" }, URL)).toBeNull();
    expect(parseAdelaideEvent({ title: "RUN 1 - x" }, URL)).toBeNull();
  });

  it("returns null on malformed title", () => {
    expect(
      parseAdelaideEvent({ title: "Just some announcement", start: "2026-04-13 19:00:00" }, URL),
    ).toBeNull();
  });
});

describe("adelaide-h3 parseAdelaideDetail (#705)", () => {
  const sampleContent = `<div class='times'>20/04/2026 7:00 pm &ndash;  10:00 pm</div>
<div class='category'>Hash Runs</div>
<div class='round5 duration'></div>
<div class='description'>Cheap Burgers n Beers</div>
<a href='http://maps.google.com/?q=233+Currie+St%2C+Adelaide+SA+5000' class='round5 maplink cat4' target='_blank' rel='external'>View Map</a>
<div class='round5 location'>
<span>The Ed Castle Hotel</span>
<span>233 Currie St, Adelaide SA 5000</span>
</div>
<div class='contact'>
</div>`;

  it("extracts venue, address, description, and map url", () => {
    const d = parseAdelaideDetail(sampleContent);
    expect(d.location).toBe("The Ed Castle Hotel");
    expect(d.locationStreet).toBe("233 Currie St, Adelaide SA 5000");
    expect(d.description).toBe("Cheap Burgers n Beers");
    expect(d.locationUrl).toBe("http://maps.google.com/?q=233+Currie+St%2C+Adelaide+SA+5000");
  });

  it("returns undefined fields when content is empty", () => {
    const d = parseAdelaideDetail("");
    expect(d.location).toBeUndefined();
    expect(d.locationStreet).toBeUndefined();
    expect(d.description).toBeUndefined();
    expect(d.locationUrl).toBeUndefined();
  });

  // #1059: special-run titles append the event theme to the title after a
  // comma — the WordPress description field separately holds the theme. Strip
  // it from hares when the two strings overlap.
  describe("stripThemeFromHares (#1059)", () => {
    it("removes a description that exactly matches a comma-segment of hares", () => {
      expect(stripThemeFromHares("Nifty & MoPed, Anzac Day run", "Anzac Day run"))
        .toBe("Nifty & MoPed");
    });

    it("works regardless of segment order (post-normalize sort)", () => {
      // normalizeHaresField sorts alphabetically, so "Anzac…" lands first.
      expect(stripThemeFromHares("Anzac Day run, Nifty & MoPed", "Anzac Day run"))
        .toBe("Nifty & MoPed");
    });

    it("is case-insensitive", () => {
      expect(stripThemeFromHares("Crunchy Crack, ONSIE RUN", "Onsie Run"))
        .toBe("Crunchy Crack");
    });

    it("leaves hares untouched when description does not appear as a segment", () => {
      expect(stripThemeFromHares("Crunchy Crack", "Onsie Run"))
        .toBe("Crunchy Crack");
    });

    it("returns the original when description is empty", () => {
      expect(stripThemeFromHares("Nifty & MoPed", undefined)).toBe("Nifty & MoPed");
      expect(stripThemeFromHares("Nifty & MoPed", "")).toBe("Nifty & MoPed");
    });

    it("returns undefined when the only segment matches the description", () => {
      // Defensive case — a hare named exactly the same as the theme string.
      expect(stripThemeFromHares("Anzac Day run", "Anzac Day run")).toBeUndefined();
    });
  });

  it("drops placeholder TBA venue/street + stale map URL (#705 polish)", () => {
    // Source leaves "TBA" in both spans when a location hasn't been set. The
    // associated `maplink` href is a bare `?q=TBA` — useless to the pipeline.
    const tbaContent = `<a href='http://maps.google.com/?q=TBA' class='maplink'>View Map</a>
<div class='location'>
<span>TBA</span>
<span>TBA</span>
</div>`;
    const d = parseAdelaideDetail(tbaContent);
    expect(d.location).toBeUndefined();
    expect(d.locationStreet).toBeUndefined();
    expect(d.locationUrl).toBeUndefined();
  });
});

describe("adelaide-h3 adelaideWallClockToUnix", () => {
  // Adelaide DST: ACST (UTC+9:30) ↔ ACDT (UTC+10:30). Transitions happen at
  // 02:00 local on the first Sunday of April (→ ACST) and October (→ ACDT).
  //
  // A 19:00 wall-clock run therefore has different UTC epochs depending on
  // which side of the transition it falls on. The helper must honor that.

  it("treats pre-April-transition date as ACDT (UTC+10:30)", () => {
    // 2026-04-04 19:00 local = ACDT = 2026-04-04 08:30 UTC = 1775550600
    const unix = adelaideWallClockToUnix("2026-04-04 19:00:00");
    expect(unix).toBe(Math.floor(Date.UTC(2026, 3, 4, 8, 30) / 1000));
  });

  it("treats post-April-transition date as ACST (UTC+9:30)", () => {
    // First Sunday of April 2026 = the 5th; 19:00 on the 6th is already ACST
    // 2026-04-06 19:00 local = ACST = 2026-04-06 09:30 UTC
    const unix = adelaideWallClockToUnix("2026-04-06 19:00:00");
    expect(unix).toBe(Math.floor(Date.UTC(2026, 3, 6, 9, 30) / 1000));
  });

  it("treats pre-October-transition date as ACST (UTC+9:30)", () => {
    // First Sunday of October 2026 = the 4th; 19:00 on the 3rd is still ACST
    // 2026-10-03 19:00 local = ACST = 2026-10-03 09:30 UTC
    const unix = adelaideWallClockToUnix("2026-10-03 19:00:00");
    expect(unix).toBe(Math.floor(Date.UTC(2026, 9, 3, 9, 30) / 1000));
  });

  it("treats post-October-transition date as ACDT (UTC+10:30)", () => {
    // 2026-10-05 19:00 local = ACDT = 2026-10-05 08:30 UTC
    const unix = adelaideWallClockToUnix("2026-10-05 19:00:00");
    expect(unix).toBe(Math.floor(Date.UTC(2026, 9, 5, 8, 30) / 1000));
  });

  it("returns null for malformed input", () => {
    expect(adelaideWallClockToUnix("not-a-date")).toBeNull();
    expect(adelaideWallClockToUnix("")).toBeNull();
  });
});
