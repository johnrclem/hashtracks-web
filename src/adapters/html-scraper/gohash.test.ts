import { extractInitialState, parseGoHashRun } from "./gohash";

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <div id="app"></div>
  <script>
    window.__INITIAL_STATE__ = {"detection":{"host":"x"},"runs":{"runs":[
      {"run_number":3167,"run_date":"2026-04-13","run_name":null,"hare":"5 Minutes","runsite":"Kali Corner","runsite_url":"https://maps.app.goo.gl/6sYjGXsrKKKJzsp68","runsite_links":[{"kind":"google","label":"Google Maps","url":"https://maps.app.goo.gl/6sYjGXsrKKKJzsp68"}]},
      {"run_number":3168,"run_date":"2026-04-20","hare":"Fleabag, Oyster Licker","runsite":"Balik Pulau","runsite_url":null,"runsite_links":null}
    ]}};
  </script>
</body>
</html>`;

describe("extractInitialState", () => {
  it("parses a balanced JSON blob after the marker", () => {
    const state = extractInitialState(SAMPLE_HTML);
    expect(state).not.toBeNull();
    expect(state?.runs?.runs).toHaveLength(2);
    expect(state?.runs?.runs?.[0].run_number).toBe(3167);
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

  it("parses a full run with external links", () => {
    const run = {
      run_number: 3167,
      run_date: "2026-04-13",
      hare: "5 Minutes",
      runsite: "Kali Corner",
      runsite_url: "https://maps.app.goo.gl/6sYjGXsrKKKJzsp68",
      runsite_links: [
        { kind: "google", label: "Google Maps", url: "https://maps.app.goo.gl/6sYjGXsrKKKJzsp68" },
        { kind: "waze", label: "Waze", url: "https://waze.com/ul/xyz" },
      ],
    };
    const event = parseGoHashRun(run, config, "https://penanghash3.org/hareline/upcoming");
    expect(event).not.toBeNull();
    expect(event?.date).toBe("2026-04-13");
    expect(event?.runNumber).toBe(3167);
    expect(event?.hares).toBe("5 Minutes");
    expect(event?.location).toBe("Kali Corner");
    expect(event?.locationUrl).toBe("https://maps.app.goo.gl/6sYjGXsrKKKJzsp68");
    expect(event?.startTime).toBe("17:30");
    expect(event?.kennelTag).toBe("penangh3");
    // Deduped: locationUrl removed from externalLinks
    expect(event?.externalLinks).toEqual([
      { url: "https://waze.com/ul/xyz", label: "Waze" },
    ]);
  });

  it("sorts comma-separated hares for stable fingerprint", () => {
    const run = { run_number: 3168, run_date: "2026-04-20", hare: "Fleabag, Oyster Licker" };
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
  });
});
