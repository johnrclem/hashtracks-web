import { parseBkkHarriettesPost } from "./bkk-harriettes";
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
    expect(event?.kennelTag).toBe("bkk-harriettes");
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
