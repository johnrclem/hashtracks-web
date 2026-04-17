import { describe, expect, it } from "vitest";
import { parseAdelaideEvent, parseAdelaideDetail } from "./adelaide-h3";

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
    expect(e!.kennelTag).toBe("ah3-au");
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
});
