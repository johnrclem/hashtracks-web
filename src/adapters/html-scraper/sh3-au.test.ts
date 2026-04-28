import { describe, expect, it } from "vitest";
import { parseSh3Paragraph } from "./sh3-au";

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

  it("returns null when Run # is missing", () => {
    expect(parseSh3Paragraph("Next Few Weeks", URL, REF)).toBeNull();
  });

  it("returns null when Date is unparseable", () => {
    const text = "Run #3071Date: TBCHares: TBA";
    expect(parseSh3Paragraph(text, URL, REF)).toBeNull();
  });
});
