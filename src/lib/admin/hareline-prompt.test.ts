import {
  buildHarelinePrompt,
  type HarelinePromptInputs,
} from "./hareline-prompt";

const FIXTURE: HarelinePromptInputs = {
  recentlyFixed: [
    { issueNumber: 1116, title: "13 metadata fixes", closedDate: "2026-04-29" },
    { issueNumber: 974, title: "10 Chrome-audit issues", closedDate: "2026-04-26" },
  ],
  focusAreas: [
    {
      sourceName: "Princeton NJ Hash Calendar",
      sourceType: "GOOGLE_CALENDAR",
      addedDate: "2026-04-28",
    },
    {
      sourceName: "Boulder H3 Website",
      sourceType: "HTML_SCRAPER",
      addedDate: "2026-04-25",
    },
  ],
};

describe("buildHarelinePrompt", () => {
  it("includes scope=all hareline URL and stream-attribution label guidance", () => {
    const prompt = buildHarelinePrompt(FIXTURE);
    expect(prompt).toContain("hashtracks.xyz/hareline?scope=all");
    expect(prompt).toContain("audit:chrome-event");
    expect(prompt).toContain("kennel:{KENNEL_CODE}");
  });

  it("renders the recently-fixed list from injected closed issues", () => {
    const prompt = buildHarelinePrompt(FIXTURE);
    expect(prompt).toContain("#1116");
    expect(prompt).toContain("13 metadata fixes");
    expect(prompt).toContain("closed 2026-04-29");
    expect(prompt).toContain("#974");
  });

  it("falls back to a no-closures notice when nothing was closed in window", () => {
    const prompt = buildHarelinePrompt({ ...FIXTURE, recentlyFixed: [] });
    expect(prompt).toContain("no audit issues closed in the last 14 days");
  });

  it("renders focus areas from injected newly-onboarded sources", () => {
    const prompt = buildHarelinePrompt(FIXTURE);
    expect(prompt).toContain("Princeton NJ Hash Calendar");
    expect(prompt).toContain("GOOGLE_CALENDAR");
    expect(prompt).toContain("added 2026-04-28");
    expect(prompt).toContain("Boulder H3 Website");
    expect(prompt).toContain("HTML_SCRAPER");
  });

  it("falls back to a 'broaden audit' notice when no sources were onboarded", () => {
    const prompt = buildHarelinePrompt({ ...FIXTURE, focusAreas: [] });
    expect(prompt).toContain("no new sources onboarded in the last 14 days");
  });

  it("links to the live suppressions endpoint and the audit-checks rule registry", () => {
    const prompt = buildHarelinePrompt(FIXTURE);
    expect(prompt).toContain("https://hashtracks.xyz/api/audit/suppressions");
    expect(prompt).toContain("src/pipeline/audit-checks.ts");
  });

  it("enumerates schema-gap fields explicitly with cross-references to schema issues", () => {
    // Same field list and #503/#504 cross-references as the deep-dive prompt,
    // so schema-gap routing is consistent across both chrome streams.
    const prompt = buildHarelinePrompt(FIXTURE);
    expect(prompt).toContain("`endTime`");
    expect(prompt).toContain("#504");
    expect(prompt).toContain("`cost`");
    expect(prompt).toContain("#503");
    expect(prompt).toContain("`schema-gap`");
  });

  it("preserves the dedup-against-existing-issues block (not a regression from the static doc)", () => {
    const prompt = buildHarelinePrompt(FIXTURE);
    expect(prompt).toContain(
      "label%3Aaudit+is%3Aopen",
    );
    expect(prompt).toContain("same kennel + same field");
  });

  it("preserves the verbatim-source-text contract for filing bodies", () => {
    const prompt = buildHarelinePrompt(FIXTURE);
    expect(prompt).toContain("verbatim text from the source");
    expect(prompt).toContain("exact text from the HashTracks page, verbatim");
  });
});
