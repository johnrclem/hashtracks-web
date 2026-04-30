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

// Pre-compute once. Same parametric pattern as the deep-dive test —
// keeps Sonar's S4144 from flagging the file as a duplication hot spot.
const prompt = buildHarelinePrompt(FIXTURE);

const CONTAINS_CASES: ReadonlyArray<{
  label: string;
  expected: readonly string[];
}> = [
  // scope=all is the canonical view; the stream attribution label routes
  // each finding to the right dashboard bucket.
  {
    label: "scope=all hareline URL + stream-attribution label guidance",
    expected: [
      "hashtracks.xyz/hareline?scope=all",
      "audit:chrome-event",
      "kennel:{KENNEL_CODE}",
    ],
  },
  // Recently-fixed list rotates from the auditIssue mirror.
  {
    label: "recently-fixed list rendered from injected closed issues",
    expected: ["#1116", "13 metadata fixes", "closed 2026-04-29", "#974"],
  },
  // Focus-areas list rotates from Source.createdAt.
  {
    label: "focus areas rendered from injected onboarded sources",
    expected: [
      "Princeton NJ Hash Calendar",
      "GOOGLE_CALENDAR",
      "added 2026-04-28",
      "Boulder H3 Website",
      "HTML_SCRAPER",
    ],
  },
  // Live suppressions endpoint + rule registry pointer.
  {
    label: "suppressions endpoint + audit-checks rule registry links",
    expected: [
      "https://hashtracks.xyz/api/audit/suppressions",
      "src/pipeline/audit-checks.ts",
    ],
  },
  // Same schema-gap framing as deep-dive — keeps both chrome streams
  // consistent on routing schema-shaped findings to PRD instead of adapter.
  {
    label: "schema-gap field list with #503/#504 cross-references",
    expected: ["`endTime`", "#504", "`cost`", "#503", "`schema-gap`"],
  },
  // Dedup-against-existing-issues block — agents must check open + recent
  // closed audit issues before filing anything.
  {
    label: "dedup-against-existing-issues block",
    expected: ["label%3Aaudit+is%3Aopen", "same kennel + same field"],
  },
  // Verbatim-source contract on filing bodies.
  {
    label: "verbatim-source contract for filing bodies",
    expected: [
      "verbatim text from the source",
      "exact text from the HashTracks page, verbatim",
    ],
  },
];

describe("buildHarelinePrompt", () => {
  it.each(CONTAINS_CASES)("contains $label", ({ expected }) => {
    for (const substring of expected) {
      expect(prompt).toContain(substring);
    }
  });

  it("falls back to a no-closures notice when nothing was closed in window", () => {
    const empty = buildHarelinePrompt({ ...FIXTURE, recentlyFixed: [] });
    expect(empty).toContain("no audit issues closed in the last 14 days");
  });

  it("falls back to a 'broaden audit' notice when no sources were onboarded", () => {
    const empty = buildHarelinePrompt({ ...FIXTURE, focusAreas: [] });
    expect(empty).toContain("no new sources onboarded in the last 14 days");
  });
});
