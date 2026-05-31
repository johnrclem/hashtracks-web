import { describe, it, expect, vi } from "vitest";

// fetchHTMLPage (real) calls safeFetch, which does a DNS SSRF check — mock the
// safe-fetch seam so the fetch() tests stay offline (matches atlanta-hash-board).
vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
import { safeFetch } from "@/adapters/safe-fetch";
import {
  parseRunNumber,
  parseRunLabel,
  parseHares,
  parseHarelineLine,
  MijasHashAdapter,
} from "./mijas-hash";

const mockSafeFetch = vi.mocked(safeFetch);

describe("parseRunNumber", () => {
  it.each([
    ["2020", 2020],
    ["2000", 2000],
    ["1999a", 1999], // away-weekend sub-run — base number
    ["1999b", 1999],
  ])("parses %s -> %i", (token, expected) => {
    expect(parseRunNumber(token)).toBe(expected);
  });

  it("returns null for non-numeric token", () => {
    expect(parseRunNumber("Glampout")).toBeNull();
  });
});

describe("parseRunLabel", () => {
  it.each([
    ["1999a", "a"],
    ["1999b", "b"],
  ])("captures the sub-letter from %s -> %s", (token, expected) => {
    expect(parseRunLabel(token)).toBe(expected);
  });

  it.each([["2020"], ["2000"], ["Glampout"]])(
    "returns undefined for a label-less token (%s)",
    (token) => {
      expect(parseRunLabel(token)).toBeUndefined();
    },
  );
});

describe("parseHares", () => {
  it("splits on & and sorts for fingerprint stability", () => {
    expect(parseHares("Shaggy & AguaSex")).toBe("AguaSex, Shaggy");
  });

  it("returns undefined for empty slot", () => {
    expect(parseHares("")).toBeUndefined();
  });

  it("handles a single hare", () => {
    expect(parseHares("Just Say When")).toBe("Just Say When");
  });
});

describe("parseHarelineLine", () => {
  const REF = new Date("2026-05-30T00:00:00Z");

  it("parses a 4-segment line with hares and theme", () => {
    const event = parseHarelineLine("2020 - 31 May 2026 - Shaggy & AguaSex - AGM Run", REF);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-05-31");
    expect(event!.kennelTags).toEqual(["mijash3"]);
    expect(event!.runNumber).toBe(2020);
    expect(event!.hares).toBe("AguaSex, Shaggy");
    expect(event!.title).toBe("AGM Run");
  });

  it("parses a 3-segment line (hares, no theme) — title stays undefined", () => {
    const event = parseHarelineLine("2022 - 14 June 2026 - Just Say When", REF);
    expect(event!.date).toBe("2026-06-14");
    expect(event!.runNumber).toBe(2022);
    expect(event!.hares).toBe("Just Say When");
    expect(event!.title).toBeUndefined();
  });

  it("parses an empty-hares slot (- -) keeping the theme", () => {
    const event = parseHarelineLine("2023 - 20 June 2026 - - Glampout Weekend", REF);
    expect(event!.date).toBe("2026-06-20");
    expect(event!.hares).toBeUndefined();
    expect(event!.title).toBe("Glampout Weekend");
  });

  it("parses a single-hare line with theme", () => {
    const event = parseHarelineLine("2019 - 24 May 2026 - Mummy's Boy - Mummy's Boy Birthday Run", REF);
    expect(event!.runNumber).toBe(2019);
    expect(event!.hares).toBe("Mummy's Boy");
    expect(event!.title).toBe("Mummy's Boy Birthday Run");
  });

  it("splits a/b sub-runs into distinct events via eventLabel (#1848)", () => {
    const a = parseHarelineLine("1999a - 04 January 2026 - Stiffanny & From Behind", REF);
    const b = parseHarelineLine("1999b - 11 January 2026 - Big Brother & Blanka Wanka", REF);
    // Base run number is shared; the sub-letter rides on eventLabel so the merge
    // same-sourceUrl date-correction can't collapse the two dated sub-runs.
    expect(a!.runNumber).toBe(1999);
    expect(a!.eventLabel).toBe("a");
    expect(a!.date).toBe("2026-01-04");
    expect(b!.runNumber).toBe(1999);
    expect(b!.eventLabel).toBe("b");
    expect(b!.date).toBe("2026-01-11");
  });

  it("emits no eventLabel for a plain integer run number", () => {
    const event = parseHarelineLine("2020 - 31 May 2026 - Shaggy & AguaSex - AGM Run", REF);
    expect(event!.eventLabel).toBeUndefined();
  });

  it("parses the date from the line, not from order (Aug parses independently)", () => {
    const event = parseHarelineLine("2032 - 16 August 2026 - Cardinal Colonic Irrigation & Five Knuckle Shuffle - CCI Elvis Birthday Run", REF);
    expect(event!.date).toBe("2026-08-16");
    expect(event!.title).toBe("CCI Elvis Birthday Run");
  });

  it("parses a bare row with no hares or theme", () => {
    const event = parseHarelineLine("2025 - 28 June 2026", REF);
    expect(event!.runNumber).toBe(2025);
    expect(event!.date).toBe("2026-06-28");
    expect(event!.hares).toBeUndefined();
    expect(event!.title).toBeUndefined();
  });

  it("returns null when no parseable date is present", () => {
    expect(parseHarelineLine("2099 - some narrative text", REF)).toBeNull();
  });

  it("preserves hyphenated hare/theme text (no split on internal hyphens)", () => {
    const event = parseHarelineLine(
      "2040 - 06 September 2026 - Five-Knuckle Shuffle & Short-n-Sweet - Anne-Marie Birthday Run",
      REF,
    );
    expect(event!.hares).toBe("Five-Knuckle Shuffle, Short-n-Sweet");
    expect(event!.title).toBe("Anne-Marie Birthday Run");
  });
});

// Real DOM slice: <li><p> rows with color <span>s, a line-through past row,
// and a two-<span> empty-hares row. DOM order is deliberately scrambled
// (August block before May) to prove date-from-line parsing.
const SAMPLE_HTML = `
<html><body>
<ul class="sqs-block-content">
  <li><p class="" style="white-space:pre-wrap;"><span class="sqsrte-text-color--custom" style="color: rgb(250, 5, 5);">2032 - 16 August 2026 </span><span class="sqsrte-text-color--black">- Cardinal Colonic Irrigation &amp; Five Knuckle Shuffle - CCI Elvis Birthday Run</span></p></li>
  <li><p class="" style="white-space:pre-wrap;"><span class="sqsrte-text-color--custom" style="color: rgb(250, 5, 5);">2033 - 23 August 2026 -</span></p></li>
  <li><p class="" style="white-space:pre-wrap;"><span style="text-decoration: line-through;">2018 - 17 May 2026 - From Behind &amp; Bad Weasel -</span></p></li>
  <li><p class="" style="white-space:pre-wrap;"><span class="sqsrte-text-color--custom" style="color: rgb(249, 4, 4);">2020 - 31 May 2026</span> - Shaggy &amp; AguaSex - AGM Run</p></li>
  <li><p class="" style="white-space:pre-wrap;"><span class="sqsrte-text-color--custom" style="color: rgb(250, 5, 5);">2023 - 20 June 2026 </span><span class="sqsrte-text-color--black">-           - Glampout Weekend </span></p></li>
  <li><p class="" style="white-space:pre-wrap;">2025 - 28 June 2026</p></li>
</ul>
<nav><ul><li><a href="/home">Home</a></li><li><a href="/run-directions">Run Directions</a></li></ul></nav>
</body></html>
`;

describe("MijasHashAdapter.fetch", () => {
  it("parses sample HTML, ignores nav <li>, and resolves all to mijash3", async () => {
    mockSafeFetch.mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new MijasHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.mijash3.com/hareline",
    } as never);

    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBeDefined();
    // 6 run rows; the two nav <li> are skipped by the run-row gate.
    expect(result.events).toHaveLength(6);
    expect(result.events.every((e) => e.kennelTags[0] === "mijash3")).toBe(true);
    expect(result.events.every((e) => e.startTime === undefined)).toBe(true);

    const byRun = Object.fromEntries(result.events.map((e) => [e.runNumber, e]));
    expect(byRun[2032].date).toBe("2026-08-16");
    expect(byRun[2032].title).toBe("CCI Elvis Birthday Run");
    expect(byRun[2020].date).toBe("2026-05-31");
    expect(byRun[2020].hares).toBe("AguaSex, Shaggy");
    expect(byRun[2023].hares).toBeUndefined();
    expect(byRun[2023].title).toBe("Glampout Weekend");
    expect(byRun[2018].date).toBe("2026-05-17"); // line-through past row still parsed

    mockSafeFetch.mockReset();
  });

  it("fails loud (records an error) when a run row won't parse, to block reconcile", async () => {
    const html = `
<html><body><ul>
  <li><p><span>2020 - 31 May 2026 - Shaggy &amp; AguaSex - AGM Run</span></p></li>
  <li><p><span>2021 - 07 Junne 2026 - From Behind</span></p></li>
</ul></body></html>`;
    mockSafeFetch.mockResolvedValueOnce(new Response(html, { status: 200 }));

    const adapter = new MijasHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.mijash3.com/hareline",
    } as never);

    // The good row still parses, but the malformed row surfaces in errors[] so
    // scrape.ts (events>0 && errors===0) will NOT run the destructive reconcile.
    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBe(2020);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errorDetails?.parse?.length).toBeGreaterThan(0);

    mockSafeFetch.mockReset();
  });

  it("returns fetch error on HTTP error", async () => {
    mockSafeFetch.mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );

    const adapter = new MijasHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.mijash3.com/hareline",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(403);

    mockSafeFetch.mockReset();
  });

  it("returns fetch error on network failure", async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error("Network error"));

    const adapter = new MijasHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.mijash3.com/hareline",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch).toHaveLength(1);

    mockSafeFetch.mockReset();
  });
});
