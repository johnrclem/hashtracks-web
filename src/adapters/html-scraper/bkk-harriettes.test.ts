import { parseBkkHarriettesPost, parseBkkHarrietteHarelineTable } from "./bkk-harriettes";
import type { WordPressComPage } from "../wordpress-api";

function makePage(overrides: Partial<WordPressComPage> = {}): WordPressComPage {
  return {
    ID: 1,
    title: "Next Run",
    content: "",
    URL: "https://bangkokharriettes.wordpress.com/next-run/",
    date: "2000-01-01T00:00:00", // always hardcoded to 2000
    modified: "2026-04-01T00:00:00", // last updated with current run details
    type: "post",
    slug: "next-run",
    ...overrides,
  };
}

describe("parseBkkHarriettesPost", () => {
  it("parses the real 'Run no. NNNN on DAY DATE at TIME' format", () => {
    const post = makePage({
      content: `
<div style="border: solid 3px magenta;border-radius: 25px;width: 97%;text-align: left;margin-left: auto;margin-right: auto;padding-left: 20px;padding-top: 20px"><strong>Run no. 2259 on Wednesday 15 April at 17:30</strong><br />
<strong>Hare:-</strong> Hazukashii<br />
<strong>Location:- </strong>TBA
</div>`,
    });
    const event = parseBkkHarriettesPost(post);
    expect(event).not.toBeNull();
    expect(event?.date).toBe("2026-04-15");
    expect(event?.kennelTags[0]).toBe("bkk-harriettes");
    expect(event?.runNumber).toBe(2259);
    expect(event?.hares).toBe("Hazukashii");
    // TBA should be excluded
    expect(event?.location).toBeUndefined();
    expect(event?.startTime).toBe("17:30");
  });

  it("parses with a real location (not TBA)", () => {
    const post = makePage({
      content: `
<div><strong>Run no. 2258 on Wednesday 9 April at 17:30</strong><br />
<strong>Hare:-</strong> Jelly Bean<br />
<strong>Location:- </strong>Benchasiri Park, Sukhumvit Soi 22
</div>`,
    });
    const event = parseBkkHarriettesPost(post);
    expect(event).not.toBeNull();
    expect(event?.location).toBe("Benchasiri Park, Sukhumvit Soi 22");
    expect(event?.hares).toBe("Jelly Bean");
  });

  it("returns null when no date can be extracted", () => {
    const post = makePage({
      content: "<p>Coming soon...</p>",
    });
    const event = parseBkkHarriettesPost(post);
    expect(event).toBeNull();
  });

  it("uses default start time when no time in run line", () => {
    const post = makePage({
      content: `
<div><strong>Run no. 2260 on Wednesday 22 April</strong><br />
<strong>Hare:-</strong> Speedy
</div>`,
    });
    const event = parseBkkHarriettesPost(post);
    expect(event).not.toBeNull();
    expect(event?.startTime).toBe("17:30");
  });

  it("falls back to labeled Date field format", () => {
    const post = makePage({
      content: `
<p><strong>Run Number:</strong> 2150</p>
<p><strong>Date:</strong> Wednesday 9th April 2025</p>
<p><strong>Time:</strong> 5:30 PM</p>
<p><strong>Hare:</strong> Jelly Bean</p>
<p><strong>Location:</strong> Benchasiri Park</p>
`,
    });
    const event = parseBkkHarriettesPost(post);
    expect(event).not.toBeNull();
    expect(event?.date).toBe("2025-04-09");
  });
});

describe("parseBkkHarrietteHarelineTable", () => {
  // Mirrors the live homepage / /hareline-in-full/ structure (verified
  // 2026-05-10): a 4-col `<table>` with header row, asterisk legend, and
  // mostly-TBA future rows.
  const sampleHomepageTable = `
<table>
<tr>
  <td colspan="4"><strong>* To be confirmed</strong></td>
</tr>
<tr>
  <td><strong>Run</strong></td>
  <td><strong>Date</strong></td>
  <td><strong>Hare</strong></td>
  <td><strong>Location</strong></td>
</tr>
<tr>
  <td>2261</td>
  <td>29 Apr</td>
  <td>Lily &#8216;Slippery When Wet&#8217; C</td>
  <td>Chinatown, Hoy Kom Pan Lan</td>
</tr>
<tr>
  <td>2263</td>
  <td>13 May</td>
  <td>Su &#8216;No Boyfriend&#8217; T</td>
  <td>TBA</td>
</tr>
<tr>
  <td>2268</td>
  <td>17 Jun</td>
  <td>Neil &#8216;Weed Eater&#8217; B *</td>
  <td>TBA</td>
</tr>
</table>`;

  it("parses three data rows, skipping header + legend", () => {
    const refDate = new Date(Date.UTC(2026, 4, 1)); // 2026-05-01
    const events = parseBkkHarrietteHarelineTable(
      sampleHomepageTable,
      refDate,
      "https://bangkokharriettes.wordpress.com",
    );
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.runNumber)).toEqual([2261, 2263, 2268]);
    expect(events[0].kennelTags).toEqual(["bkk-harriettes"]);
    expect(events[0].startTime).toBe("17:30");
    expect(events[0].sourceUrl).toBe("https://bangkokharriettes.wordpress.com");
  });

  it("decodes entities and preserves real hare + location values", () => {
    const refDate = new Date(Date.UTC(2026, 4, 1));
    const events = parseBkkHarrietteHarelineTable(
      sampleHomepageTable,
      refDate,
      "https://bangkokharriettes.wordpress.com",
    );
    const e0 = events[0];
    expect(e0.hares).toBe("Lily ‘Slippery When Wet’ C");
    expect(e0.location).toBe("Chinatown, Hoy Kom Pan Lan");
    expect(e0.date).toBe("2026-04-29");
  });

  it("treats TBA location and TBA hares as undefined", () => {
    const refDate = new Date(Date.UTC(2026, 4, 1));
    const events = parseBkkHarrietteHarelineTable(
      `<table><tr><td>2271</td><td>8 Jul</td><td>TBA</td><td>TBA</td></tr></table>`,
      refDate,
      "https://x",
    );
    expect(events).toHaveLength(1);
    expect(events[0].hares).toBeUndefined();
    expect(events[0].location).toBeUndefined();
  });

  it("strips trailing '*' to-be-confirmed marker from hares", () => {
    const refDate = new Date(Date.UTC(2026, 4, 1));
    const events = parseBkkHarrietteHarelineTable(
      sampleHomepageTable,
      refDate,
      "https://x",
    );
    const neil = events.find((e) => e.runNumber === 2268);
    expect(neil?.hares).toBe("Neil ‘Weed Eater’ B");
  });

  it("year-rolls forward when refDate is past the row's month", () => {
    // refDate Feb 1, row "30 Dec" — chrono forwardDate should pick the
    // current year if Dec hasn't passed yet, otherwise next year. With
    // refDate Feb 2026 and row "30 Dec", forwardDate yields 2026-12-30.
    const refDate = new Date(Date.UTC(2026, 1, 1));
    const events = parseBkkHarrietteHarelineTable(
      `<table><tr><td>2296</td><td>30 Dec</td><td>TBA</td><td>TBA</td></tr></table>`,
      refDate,
      "https://x",
    );
    expect(events[0].date).toBe("2026-12-30");
  });

  it("ignores rows that aren't 4 cells", () => {
    const refDate = new Date(Date.UTC(2026, 4, 1));
    const events = parseBkkHarrietteHarelineTable(
      `<table>
        <tr><td>only-one-cell</td></tr>
        <tr><td>2271</td><td>8 Jul</td><td>TBA</td><td>TBA</td></tr>
        <tr><td>a</td><td>b</td><td>c</td></tr>
       </table>`,
      refDate,
      "https://x",
    );
    expect(events).toHaveLength(1);
    expect(events[0].runNumber).toBe(2271);
  });
});
