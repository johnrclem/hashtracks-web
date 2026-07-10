import { describe, it, expect } from "vitest";
import {
  parseGatrTitle,
  parseGatrBody,
  processPost,
} from "./gatrh3";
import type { ErrorDetails } from "../types";

// Real content.rendered captured live from gatrh3.wordpress.com (2026-07).
const POST_343 = {
  id: 1572,
  date: "2026-06-04T14:00:00",
  link: "https://gatrh3.wordpress.com/2026/06/04/gatrh3-343/",
  title: {
    rendered:
      "Gainesville Hash Trail (GATRH3 #343 AD) Friday the 13th (on&nbsp;Saturday)",
  },
  content: {
    rendered:
      '\n<p class="wp-block-paragraph">When: <strong>Saturday, June 13, 2026</strong>, at <strong>4:45pm</strong> ET</p>\n\n\n\n<p class="wp-block-paragraph">Location: GRU parking lot at 407 SE 2nd St, Gainesville, FL 32601<br>Length: 2.69 miles (walkers welcome)<br>Shiggy: 3.69<br>Hash Cash: $10<br>Theme: Friday the 13th! Yes, its Saturday the 13th, but Jason has a hangover.<br>Come as a camper, Jason, or any of your favorite slash flick characters.</p>\n',
  },
};

// Format-drift post: "Meet at:" (not "Location:"), "pin:&nbsp;<a>" maps link,
// bare "$5 hash cash", and "Length:" tucked onto the Shiggy line.
const POST_336 = {
  id: 1540,
  date: "2026-02-20T14:00:00",
  link: "https://gatrh3.wordpress.com/2026/02/20/gatrh3-336/",
  title: {
    rendered: "Gainesville Hash Trail (GATRH3 #336 AD)&nbsp;Sweetwater",
  },
  content: {
    rendered:
      '\n<p class="wp-block-paragraph">When: <strong>Saturday, February 21, 2026</strong> at <strong>2:00pm</strong> ET</p>\n\n\n\n<p class="wp-block-paragraph">Meet at: Sweetwater Preserve; pin:&nbsp;<a href="https://maps.app.goo.gl/4xyeogc4X8i1m5LEA?fbclid=IwZXtracking" target="_blank" rel="noreferrer noopener">https://maps.app.goo.gl/4xyeogc4X8i1m5LEA</a></p>\n\n\n\n<p class="wp-block-paragraph">Bring: ID and cash, flashlight, whistle.</p>\n\n\n\n<p class="wp-block-paragraph">$5 hash cash (second timers free)</p>\n\n\n\n<p class="wp-block-paragraph">Shiggy level 3/10; Length: ~3.169 miles (walkers welcome!)</p>\n',
  },
};

function run(post: typeof POST_343) {
  const errors: string[] = [];
  const errorDetails: ErrorDetails = {};
  const event = processPost(post, 0, errors, errorDetails);
  return { event, errors, errorDetails };
}

describe("parseGatrTitle", () => {
  it("extracts run number and theme, tolerating a nested parenthetical theme", () => {
    expect(
      parseGatrTitle("Gainesville Hash Trail (GATRH3 #343 AD) Friday the 13th (on Saturday)"),
    ).toEqual({ runNumber: 343, theme: "Friday the 13th (on Saturday)" });
  });

  it("returns no run number when the GATRH3 tag is absent", () => {
    expect(parseGatrTitle("UPCOMING Gainesville Hash Trails").runNumber).toBeUndefined();
  });
});

describe("parseGatrBody", () => {
  it("parses date, pack-off time, location, cost, and trail length", () => {
    const b = parseGatrBody(POST_343.content.rendered, POST_343.date);
    expect(b.date).toBe("2026-06-13");
    expect(b.startTime).toBe("16:45");
    expect(b.location).toBe("GRU parking lot at 407 SE 2nd St, Gainesville, FL 32601");
    expect(b.cost).toBe("$10");
    expect(b.trailLengthText).toBe("2.69 miles (walkers welcome)");
    expect(b.trailLengthMin).toBe(2.69);
    expect(b.trailLengthMax).toBe(2.69);
    expect(b.themeProse).toMatch(/^Friday the 13th!/);
    expect(b.hasWhenField).toBe(true);
  });

  it("handles Meet-at + pin anchor (with &nbsp;) + bare '$5 hash cash'", () => {
    const b = parseGatrBody(POST_336.content.rendered, POST_336.date);
    expect(b.date).toBe("2026-02-21");
    expect(b.startTime).toBe("14:00");
    expect(b.location).toBe("Sweetwater Preserve"); // "; pin:" stripped off
    expect(b.locationUrl).toBe("https://maps.app.goo.gl/4xyeogc4X8i1m5LEA"); // tracking query dropped
    expect(b.cost).toBe("$5");
    expect(b.trailLengthText).toBe("~3.169 miles (walkers welcome!)");
  });
});

describe("processPost", () => {
  it("emits a fully-populated event for a structured trail post", () => {
    const { event, errors } = run(POST_343);
    expect(errors).toEqual([]);
    expect(event).toMatchObject({
      date: "2026-06-13",
      kennelTags: ["gatr-h3"],
      runNumber: 343,
      startTime: "16:45",
      title: "Friday the 13th (on Saturday)",
      cost: "$10",
      trailLengthMinMiles: 2.69,
      trailLengthMaxMiles: 2.69,
      sourceUrl: POST_343.link,
    });
  });

  it("skips cancelled posts silently (no event, no error)", () => {
    const cancelled = {
      ...POST_343,
      id: 999,
      title: {
        rendered: "Gainesville Hash Trail (cancelled) Turkey Tails in Micanopy",
      },
      content: {
        rendered:
          '<p>When: <strong>Saturday, November 22, 2025</strong>, at <strong>10:00am</strong> ET</p><p>Location: TRAIL CANCELLED</p>',
      },
    };
    const { event, errors } = run(cancelled);
    expect(event).toBeNull();
    expect(errors).toEqual([]);
  });

  it("skips a non-trail index post (no When: field) without logging an error", () => {
    const index = {
      ...POST_343,
      id: 1000,
      title: { rendered: "UPCOMING Gainesville Hash Trails" },
      content: { rendered: "<p>Check back here for upcoming trails.</p>" },
    };
    const { event, errors, errorDetails } = run(index);
    expect(event).toBeNull();
    expect(errors).toEqual([]);
    expect(errorDetails.parse).toBeUndefined();
  });

  it("skips a malformed post (missing content) with a logged error", () => {
    const malformed = { id: 1, date: "2026-06-01T00:00:00", link: "x", title: { rendered: "x" } } as unknown as typeof POST_343;
    const { event, errors } = run(malformed);
    expect(event).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/malformed/i);
  });

  it("logs a parse error when a When: field is present but undated", () => {
    const broken = {
      ...POST_343,
      id: 1001,
      title: { rendered: "Gainesville Hash Trail (GATRH3 #350 AD) Mystery" },
      content: { rendered: "<p>When: soon, ask a hasher</p>" },
    };
    const { event, errors } = run(broken);
    expect(event).toBeNull();
    expect(errors).toHaveLength(1);
  });
});
