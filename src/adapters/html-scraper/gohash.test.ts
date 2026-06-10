import { extractInitialState, parseGoHashRun } from "./gohash";
import type { GoHashRun } from "./gohash";

// Fixtures mirror the LIVE goHash `__INITIAL_STATE__.runs.runs[]` shape:
// `location` / `location_url` / `location_links` (NOT the legacy
// `runsite*` keys). Verified against penanghash3.org + hashhouseharrietspenang.com.
// Dates are static here on purpose — these are parse-only tests with no scrape
// window, so they can't time-bomb (see feedback_windowed_adapter_test_needs_relative_dates).
const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <div id="app"></div>
  <script>
    window.__INITIAL_STATE__ = {"detection":{"host":"x"},"runs":{"runs":[
      {"run_number":3176,"run_date":"2026-06-15","run_name":null,"run_group":null,"run_group_label":null,"hare":"Mr. Cool","location":"Kali Corner","location_url":"https://maps.app.goo.gl/6sYjGXsrKKKJzsp68","location_links":[{"kind":"google","label":"Google Maps","url":"https://maps.app.goo.gl/6sYjGXsrKKKJzsp68"}],"notes":null,"run_type_name":"Normal","run_type_pricing":[{"label":"Guest","amount":30}],"pricing_currency":"MYR"},
      {"run_number":3177,"run_date":"2026-06-22","hare":"Fleabag, Oyster Licker","location":"Bukit Jambul","location_url":null,"location_links":null,"notes":"Bring a torch — night trail."}
    ]}};
  </script>
</body>
</html>`;

// Harriets Penang (hhhpenang) — same shared adapter, same field shape.
const HARRIETS_HTML = `
<html><body><script>
  window.__INITIAL_STATE__ = {"runs":{"runs":[
    {"run_number":2748,"run_date":"2026-06-11","hare":"Pussycat","location":"Waterfall Rd Big Car Park","location_url":"https://maps.app.goo.gl/iaoXsbdQ1eFyJCwg7","location_links":[{"kind":"google","label":"Google Maps","url":"https://maps.app.goo.gl/iaoXsbdQ1eFyJCwg7"}]}
  ]}};
</script></body></html>`;

describe("extractInitialState", () => {
  it("parses a balanced JSON blob after the marker", () => {
    const state = extractInitialState(SAMPLE_HTML);
    expect(state).not.toBeNull();
    expect(state?.runs?.runs).toHaveLength(2);
    expect(state?.runs?.runs?.[0].run_number).toBe(3176);
  });
  it("returns null when the marker is absent", () => {
    expect(extractInitialState("<html></html>")).toBeNull();
  });
  it("handles braces inside string literals correctly", () => {
    const html = `window.__INITIAL_STATE__ = {"runs":{"runs":[]},"note":"}}}"};`;
    const state = extractInitialState(html);
    expect(state).not.toBeNull();
    expect(state?.runs?.runs).toEqual([]);
  });
});

describe("parseGoHashRun", () => {
  const config = { kennelTag: "penangh3", startTime: "17:30" };

  it("parses a full run with location + external links", () => {
    const run = {
      run_number: 3176,
      run_date: "2026-06-15",
      hare: "Mr. Cool",
      location: "Kali Corner",
      location_url: "https://maps.app.goo.gl/6sYjGXsrKKKJzsp68",
      location_links: [
        { kind: "google", label: "Google Maps", url: "https://maps.app.goo.gl/6sYjGXsrKKKJzsp68" },
        { kind: "waze", label: "Waze", url: "https://waze.com/ul/xyz" },
      ],
    };
    const event = parseGoHashRun(run, config, "https://penanghash3.org/hareline/upcoming");
    expect(event).not.toBeNull();
    expect(event?.date).toBe("2026-06-15");
    expect(event?.runNumber).toBe(3176);
    expect(event?.hares).toBe("Mr. Cool");
    expect(event?.location).toBe("Kali Corner");
    expect(event?.locationUrl).toBe("https://maps.app.goo.gl/6sYjGXsrKKKJzsp68");
    expect(event?.startTime).toBe("17:30");
    expect(event?.kennelTags[0]).toBe("penangh3");
    // Deduped: locationUrl removed from externalLinks
    expect(event?.externalLinks).toEqual([
      { url: "https://waze.com/ul/xyz", label: "Waze" },
    ]);
  });

  it("captures notes as description", () => {
    const run = {
      run_number: 3177,
      run_date: "2026-06-22",
      location: "Bukit Jambul",
      notes: "Bring a torch — night trail.",
    };
    const event = parseGoHashRun(run, config, "x");
    expect(event?.description).toBe("Bring a torch — night trail.");
    expect(event?.location).toBe("Bukit Jambul");
  });

  it("sorts comma-separated hares for stable fingerprint", () => {
    const run = { run_number: 3177, run_date: "2026-06-22", hare: "Fleabag, Oyster Licker" };
    const event = parseGoHashRun(run, config, "x");
    expect(event?.hares).toBe("Fleabag, Oyster Licker");
    // Reversed order should produce the same sorted output
    const reversed = { ...run, hare: "Oyster Licker, Fleabag" };
    expect(parseGoHashRun(reversed, config, "x")?.hares).toBe("Fleabag, Oyster Licker");
  });

  it("returns null when run_date is missing or malformed", () => {
    expect(parseGoHashRun({ run_number: 1 }, config, "x")).toBeNull();
    expect(parseGoHashRun({ run_date: "April 13" }, config, "x")).toBeNull();
  });

  it("emits an event even when hare/location are null", () => {
    const event = parseGoHashRun(
      { run_number: 9, run_date: "2026-05-01" },
      config,
      "x",
    );
    expect(event).not.toBeNull();
    expect(event?.hares).toBeUndefined();
    expect(event?.location).toBeUndefined();
    expect(event?.description).toBeUndefined();
  });

  // Title resolution: run_name wins, then run_group_label; the opaque
  // run_group UUID must NEVER surface as a title (merge.ts synthesizes one
  // when both readable fields are empty). Shapes drawn from the real Penang H3
  // archive (Run #1 "First Run"/"Founders", #3200 "Angmohs").
  const RUN_GROUP_UUID = "cda839a5-13f9-4d70-9aab-a4c4c9a13b2e";
  it.each<{ label: string; run: GoHashRun; expected: string | undefined }>([
    { label: "run_name wins", run: { run_name: "First Run", run_group_label: "Founders", run_group: RUN_GROUP_UUID }, expected: "First Run" },
    { label: "falls back to run_group_label", run: { run_name: null, run_group_label: "Angmohs", run_group: RUN_GROUP_UUID }, expected: "Angmohs" },
    { label: "never leaks a run_group UUID", run: { run_group: RUN_GROUP_UUID }, expected: undefined },
  ])("title: $label", ({ run, expected }) => {
    const event = parseGoHashRun({ run_number: 1, run_date: "2026-04-10", ...run }, config, "x");
    expect(event?.title).toBe(expected);
  });

  it("treats an explicit null location as undefined (archive Run #1 shape)", () => {
    // Real Run #1 (1965-04-10): null hare + null location, run_name "First Run".
    const event = parseGoHashRun(
      { run_number: 1, run_date: "1965-04-10", run_name: "First Run", hare: null, location: null },
      config,
      "x",
    );
    expect(event?.title).toBe("First Run");
    expect(event?.location).toBeUndefined();
    expect(event?.hares).toBeUndefined();
  });
});

describe("shared adapter — Harriets Penang (hhhpenang) contract", () => {
  it("parses the same live field shape for the second tenant", () => {
    const state = extractInitialState(HARRIETS_HTML);
    expect(state?.runs?.runs).toHaveLength(1);
    const event = parseGoHashRun(
      state!.runs!.runs![0],
      { kennelTag: "hhhpenang", startTime: "17:30" },
      "https://www.hashhouseharrietspenang.com/hareline/upcoming",
    );
    expect(event?.location).toBe("Waterfall Rd Big Car Park");
    expect(event?.hares).toBe("Pussycat");
    expect(event?.kennelTags[0]).toBe("hhhpenang");
  });
});
