import { parseDhekeliaDate, parseDhekeliaInfo, parseDhekeliaTime } from "./dhekelia-hash";

// Trimmed from the live WP REST `content.rendered` of dhekelia-h3.com/info/ (2026-11-05).
const RENDERED = `
<div class="elementor-row">
<div class="elementor-column elementor-col-50"><div class="elementor-text-editor elementor-clearfix">
<p>Hash Number:</p><p>Date:</p><p>Time:</p><p>Hares:</p><p>Location:</p><p>Directions:</p></div></div>
<div class="elementor-column elementor-col-50"><div class="elementor-text-editor elementor-clearfix">
<p>3141</p>
<p>4/11/2026</p>
<p>16.00</p>
<p>&nbsp;Vesna</p>
<p>Kochi Area</p>
<p>&nbsp;Larnaca/Agia Napa Motorway A3</p>
<p>Exit motorway at junction 55, head towards Nicosia on A2, take first exit signed Koshi.&nbsp;</p>
<p>Alan</p>
<p>On On</p></div></div>
</div>`;

describe("Dhekelia parsing", () => {
  it("parses date and time", () => {
    expect(parseDhekeliaDate("4/11/2026")).toBe("2026-11-04");
    expect(parseDhekeliaDate("31/2/2026")).toBeNull();
    expect(parseDhekeliaTime("16.00")).toBe("16:00");
  });

  it("accepts a date with one missing separator only when unambiguous", () => {
    // Live page 2026-11-12: run #3142 typed as "11/112026".
    expect(parseDhekeliaDate("11/112026")).toBe("2026-11-11");
    expect(parseDhekeliaDate("4/12026")).toBe("2026-01-04");
    expect(parseDhekeliaDate("1111/2026")).toBe("2026-11-11");
    expect(parseDhekeliaDate("131/2026")).toBe("2026-01-13"); // 1/31 isn't a month
    // 1/11 or 11/1: ambiguous, so rejected.
    expect(parseDhekeliaDate("111/2026")).toBeNull();
    // Overflow and anything looser stay rejected.
    expect(parseDhekeliaDate("11/132026")).toBeNull();
    expect(parseDhekeliaDate("111/12026")).toBeNull();
    expect(parseDhekeliaDate("11112026")).toBeNull();
    expect(parseDhekeliaDate("11/11/26")).toBeNull();
    expect(parseDhekeliaDate("11-11-2026")).toBeNull();
    expect(parseDhekeliaTime("TBA")).toBeUndefined();
  });

  it("parses the next-run block and drops the sign-off", () => {
    const { event, foundBlock, error } = parseDhekeliaInfo(RENDERED);
    expect(foundBlock).toBe(true);
    expect(error).toBeUndefined();
    expect(event).toMatchObject({
      date: "2026-11-04",
      kennelTags: ["dh3-cy"],
      runNumber: 3141,
      startTime: "16:00",
      hares: "Vesna",
      location: "Kochi Area",
    });
    expect(event?.description).toContain("junction 55");
    expect(event?.description).not.toContain("On On");
    expect(event?.title).toBeUndefined();
  });

  it("reports a missing block", () => {
    expect(parseDhekeliaInfo("<p>nothing</p>").foundBlock).toBe(false);
  });
});
