import { describe, it, expect } from "vitest";
import { parseHkh3Homepage, nextMondayOnOrAfter } from "./hkh3";

const FIXTURE = `
<html><body>
<div class="content">
  <h2>Next H4 Run</h2>
  <p style="text-align: left;">Run Number 2969</p>
  <div>
    <span style="font-size: large;"><b>Location</b>: <a href="https://maps.app.goo.gl/gxCPV8ZLegCWebTX8?g_st=ac" target="_blank" rel="noopener">Hollywood Park Road</a></span>
  </div>
  <div><span style="font-size: large;"><b>Format: </b>A to A. Bag drop 5:30pm for Walkers</span></div>
  <div><span><b>Bus</b>: No</span></div>
  <div><span><b>ONONON</b>: Yes</span></div>
  <div>***BRING HEAD TORCH***</div>
</div>
<div>
  <h2>Contrary to our reputation,.. we DO welcome visitors</h2>
</div>
</body></html>
`;

describe("nextMondayOnOrAfter", () => {
  it("returns the same date when input is a Monday", () => {
    // 2026-04-27 is a Monday
    expect(nextMondayOnOrAfter(new Date(Date.UTC(2026, 3, 27)))).toBe("2026-04-27");
  });

  it("returns next Monday when input is Tuesday", () => {
    // 2026-04-28 (Tue) → 2026-05-04 (Mon)
    expect(nextMondayOnOrAfter(new Date(Date.UTC(2026, 3, 28)))).toBe("2026-05-04");
  });

  it("returns next Monday when input is Sunday", () => {
    // 2026-04-26 (Sun) → 2026-04-27 (Mon)
    expect(nextMondayOnOrAfter(new Date(Date.UTC(2026, 3, 26)))).toBe("2026-04-27");
  });

  it("crosses month boundary correctly", () => {
    // 2026-04-30 (Thu) → 2026-05-04 (Mon)
    expect(nextMondayOnOrAfter(new Date(Date.UTC(2026, 3, 30)))).toBe("2026-05-04");
  });
});

describe("parseHkh3Homepage", () => {
  const today = new Date(Date.UTC(2026, 3, 27)); // Monday 2026-04-27

  it("extracts run number, location, location URL, and start time", () => {
    const event = parseHkh3Homepage(FIXTURE, "https://hkhash.com/", today);
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(2969);
    expect(event!.location).toBe("Hollywood Park Road");
    expect(event!.locationUrl).toBe("https://maps.app.goo.gl/gxCPV8ZLegCWebTX8?g_st=ac");
    expect(event!.startTime).toBe("18:00");
    expect(event!.kennelTag).toBe("hkh3");
    expect(event!.title).toBe("HK H3 Run #2969");
    expect(event!.date).toBe("2026-04-27");
  });

  it("includes the format string in description", () => {
    const event = parseHkh3Homepage(FIXTURE, "https://hkhash.com/", today);
    expect(event!.description).toContain("Run #2969");
    expect(event!.description).toContain("A to A");
  });

  it("returns null when homepage lacks 'Next H4 Run' block", () => {
    const empty = "<html><body><p>Not the homepage</p></body></html>";
    expect(parseHkh3Homepage(empty, "https://hkhash.com/", today)).toBeNull();
  });

  it("falls back to generic title when run number is missing", () => {
    const noRun = `<html><body>
      <h2>Next H4 Run</h2>
      <div>Location: Some Place</div>
    </body></html>`;
    const event = parseHkh3Homepage(noRun, "https://hkhash.com/", today);
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBeUndefined();
    expect(event!.title).toBe("HK H3 Weekly Run");
  });

  it("uses next Monday when scraped on a non-Monday", () => {
    const tuesday = new Date(Date.UTC(2026, 3, 28));
    const event = parseHkh3Homepage(FIXTURE, "https://hkhash.com/", tuesday);
    expect(event!.date).toBe("2026-05-04");
  });

  // Real-site fixture: hkhash.com renders the heading as <p><strong>Next H4 Run</strong></p>
  // inside a WPBakery wpb_text_column block, NOT as <h2>. The container-finder
  // must walk up the DOM until it finds the section that holds both the
  // heading and the labeled fields.
  it("parses the live <p><strong>Next H4 Run</strong></p> WPBakery layout", () => {
    const wpbakery = `<html><body>
      <div class="vc_row">
        <div class="vc_column">
          <div class="wpb_text_column"><div class="wpb_wrapper">
            <p><strong>Next H4 Run</strong></p>
            <p>Run Number 2970</p>
            <div><span><b>Location</b>: <a href="https://maps.app.goo.gl/abc">Trail Park</a></span></div>
            <div><span><b>Format</b>: B to A</span></div>
          </div></div>
        </div>
      </div>
    </body></html>`;
    const event = parseHkh3Homepage(wpbakery, "https://hkhash.com/", today);
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(2970);
    expect(event!.location).toBe("Trail Park");
    expect(event!.locationUrl).toBe("https://maps.app.goo.gl/abc");
  });
});
