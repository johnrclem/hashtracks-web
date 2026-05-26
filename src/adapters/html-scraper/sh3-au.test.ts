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

  // #1644 — JotForm promo URL bleeds into haresText (run #3078)
  it("strips promotional Tshirt + JotForm URL from hares (#1644)", () => {
    const text =
      "Run #3078Date: 9th JuneHares: Larrikins Joint Run 2500 Special Tshirt – order here https://form.jotform.com/261247879266067Start: TBA";
    const e = parseSh3Paragraph(text, URL, REF);
    expect(e).not.toBeNull();
    expect(e!.hares).toBe("Larrikins Joint Run 2500");
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
});
