import { describe, it, expect } from "vitest";
import { parseManilaH3Page } from "./manila-h3";

const SOURCE_URL = "https://sites.google.com/site/manilah3/manila-hash-house-harriers";

/**
 * Fixture mirroring the live Google Sites markup (captured 2026-06-08). The page
 * splits words across inline <span>s ("mmd"+"ccxxviii", "saan (whe"+"re)") and
 * fragments labels from values — this fixture reproduces that fragmentation to
 * prove `stripHtmlTags` re-joins each label+value onto one logical line. The
 * <meta og:description> deliberately omits the run text; the parser reads body.
 */
const FIXTURE = `<!DOCTYPE html><html><head>
<meta property="og:title" content="manilah3">
<meta property="og:image" content="https://lh3.googleusercontent.com/sitesv/AA5AbUAtoken=w16383">
</head><body>
<div class="nav"><a href="/site/manilah3">manila hash house harriers</a><a href="/site/manilah3/photos">Photos</a></div>
<p><span>since 1972</span></p>
<p><span>[next monight's miracle]</span></p>
<p><span>ano (what): </span><span>- </span><span>mmd</span><span>ccxxviii = 2728</span></p>
<p><span>kailan (when):</span><span> - </span><span>sikoklok</span><span>mon08jun26</span></p>
<p><span>sino (who): </span><span>perverse arse likkr</span></p>
<p><span>bakit (why): laging masmasaya sa mh3 - always more fun with mh3</span></p>
<p><span>saan (whe</span><span>re)</span><span> - ilokano garage, diosdado macapagal blvd cnr pacific ave, tambo, paranaque</span></p>
<p><span>direksyon -</span></p>
<p><span>too easy - ononuckingon</span></p>
<p><span>mapa: </span><a href="https://tinyurl.com/5b7xvkt3"><span>https://tinyurl.com/5b7xvkt3</span></a></p>
<p><span>contact: squatta1@yahoo.com</span></p>
<p><span>ridikulist</span></p>
<p><span>archives/hashtory squatta</span></p>
</body></html>`;

describe("parseManilaH3Page", () => {
  it("parses the current run block across fragmented spans", () => {
    const { event, error } = parseManilaH3Page(FIXTURE, SOURCE_URL);
    expect(error).toBeUndefined();
    expect(event).not.toBeNull();
    expect(event).toMatchObject({
      date: "2026-06-08",
      runNumber: 2728,
      hares: "perverse arse likkr",
      location: "ilokano garage, diosdado macapagal blvd cnr pacific ave, tambo, paranaque",
      locationUrl: "https://tinyurl.com/5b7xvkt3",
      kennelTags: ["mh3-ph"],
      sourceUrl: SOURCE_URL,
    });
  });

  it("leaves title undefined so merge.ts synthesizes 'Manila H3 Trail #N'", () => {
    const { event } = parseManilaH3Page(FIXTURE, SOURCE_URL);
    expect(event?.title).toBeUndefined();
  });

  it("does not leak roster/prose text into hares or location", () => {
    const { event } = parseManilaH3Page(FIXTURE, SOURCE_URL);
    expect(event?.hares).toBe("perverse arse likkr");
    expect(event?.location).not.toMatch(/ridikulist|hashtory|direksyon/i);
  });

  it("still resolves hares + venue when Google Sites splits a space into a label word", () => {
    // Defensive: simulate "si no (who)" / "saan (whe re)" intra-word spacing.
    const html = FIXTURE.replace(
      "<p><span>sino (who): </span><span>perverse arse likkr</span></p>",
      "<p><span>si no (who): perverse arse likkr</span></p>",
    ).replace(
      "<p><span>saan (whe</span><span>re)</span><span> - ilokano garage, diosdado macapagal blvd cnr pacific ave, tambo, paranaque</span></p>",
      "<p><span>saan (whe re) - ilokano garage, diosdado macapagal blvd cnr pacific ave, tambo, paranaque</span></p>",
    );
    const { event } = parseManilaH3Page(html, SOURCE_URL);
    expect(event?.hares).toBe("perverse arse likkr");
    expect(event?.location).toBe(
      "ilokano garage, diosdado macapagal blvd cnr pacific ave, tambo, paranaque",
    );
  });

  it("emits the event with undefined hares/location when those labels are absent", () => {
    const html = FIXTURE.replace(
      "<p><span>sino (who): </span><span>perverse arse likkr</span></p>",
      "",
    ).replace(
      "<p><span>saan (whe</span><span>re)</span><span> - ilokano garage, diosdado macapagal blvd cnr pacific ave, tambo, paranaque</span></p>",
      "",
    );
    const { event, error } = parseManilaH3Page(html, SOURCE_URL);
    expect(error).toBeUndefined();
    expect(event?.runNumber).toBe(2728);
    expect(event?.hares).toBeUndefined();
    expect(event?.location).toBeUndefined();
  });

  it.each([
    { name: "padded day", token: "mon08jun26", expected: "2026-06-08" },
    { name: "single-digit day", token: "lok1jul26", expected: "2026-07-01" },
    { name: "december rollover", token: "sat25dec25", expected: "2025-12-25" },
  ])("parses the encoded date token: $name", ({ token, expected }) => {
    const html = FIXTURE.replace("sikoklok</span><span>mon08jun26", `sikoklok</span><span>${token}`);
    const { event } = parseManilaH3Page(html, SOURCE_URL);
    expect(event?.date).toBe(expected);
  });

  it.each([
    { name: "decimal after =", ano: "mmdccxxviii = 2728", expected: 2728 },
    { name: "roman-numeral fallback (no decimal)", ano: "mmdccxxx", expected: 2730 },
  ])("parses the run number: $name", ({ ano, expected }) => {
    const html = FIXTURE.replace("mmd</span><span>ccxxviii = 2728", `<span>${ano}`);
    const { event } = parseManilaH3Page(html, SOURCE_URL);
    expect(event?.runNumber).toBe(expected);
  });

  it("fails loud when the 'ano (what)' run block is absent", () => {
    const { event, error } = parseManilaH3Page(
      "<html><body><p>walang takbo ngayon</p></body></html>",
      SOURCE_URL,
    );
    expect(event).toBeNull();
    expect(error).toMatch(/ano \(what\)/i);
  });

  it("fails loud when the date token is unparseable (drift guard)", () => {
    const html = FIXTURE.replace("sikoklok</span><span>mon08jun26", "sikoklok</span><span>mon32jun26");
    const { event, error } = parseManilaH3Page(html, SOURCE_URL);
    expect(event).toBeNull();
    expect(error).toMatch(/could not extract date/i);
  });
});
