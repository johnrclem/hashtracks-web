import { buildDeepDivePrompt } from "./deep-dive-prompt";
import type { DeepDiveCandidate } from "@/app/admin/audit/actions";

const FIXTURE: DeepDiveCandidate = {
  kennelCode: "nych3",
  shortName: "NYCH3",
  slug: "nych3",
  region: "New York City, NY",
  lastDeepDiveAt: null,
  eventCount90d: 47,
  sources: [
    { type: "HTML_SCRAPER", url: "https://hashnyc.com", name: "hashnyc.com" },
    { type: "HASHREGO", url: "https://hashrego.com/nych3", name: "Hash Rego (NYCH3)" },
  ],
};

// Pre-compute once. The prompt is a pure function of FIXTURE; sharing the
// build keeps the test parametric (each row is just a different (label,
// substrings) pair fed into a single it.each block) and avoids the fan-out
// of near-identical it() blocks Sonar's S4144 was flagging on this file.
const prompt = buildDeepDivePrompt(FIXTURE);

/**
 * Each row is a logical contract the prompt must honor. Adding a new
 * substring guarantee = new row, no new test scaffolding. Comments inline
 * preserve the "why" notes that used to live in per-it() blocks.
 */
const CONTAINS_CASES: ReadonlyArray<{
  label: string;
  expected: readonly string[];
}> = [
  // Identity + linking — issue lands in the correct kennel/region context.
  {
    label: "kennel name, region, and HashTracks URL",
    expected: [
      "NYCH3",
      "New York City, NY",
      "https://www.hashtracks.xyz/kennels/nych3",
    ],
  },
  // Source enumeration — auditor sees every adapter type.
  {
    label: "every source with type and URL",
    expected: [
      "hashnyc.com",
      "HTML_SCRAPER",
      "https://hashnyc.com",
      "Hash Rego (NYCH3)",
      "HASHREGO",
    ],
  },
  // Last-dived display when never run.
  {
    label: "'never' for kennels without a prior deep dive",
    expected: ["Last deep dive:** never"],
  },
  // Filing instructions exist; labels list is URL-encoded so future
  // kennelCodes with reserved chars don't corrupt the link.
  {
    label: "What-to-check + filing instructions + URL-encoded labels",
    expected: ["## What to check", "## Filing findings", "audit%2Calert"],
  },
  // Stream + kennel labels in the prefilled URL — without these the
  // dashboard's "Findings by stream" panel buckets the issue as UNKNOWN.
  {
    label: "stream + kennel labels in the prefilled new-issue URL",
    expected: ["audit:chrome-kennel", "kennel:nych3"],
  },
  // Kennel-page completeness section.
  {
    label: "kennel-page improvements (founded year, social, hash cash)",
    expected: [
      "Kennel page completeness",
      "Founded year",
      "Facebook",
      "Hash Cash",
    ],
  },
  // Verify-current-state pre-step: guards against false-positive
  // "missing data" findings where the auditor inspected only the source.
  {
    label: "verify-current-state pre-step",
    expected: [
      "Verify current state before flagging",
      "spot-check 2-3 of the highest run-numbered events",
    ],
  },
  // Historical-backfill routing by source type. Wide-window scrapes
  // trigger reconcile, which cancels sole-source events the adapter
  // didn't return — safe for complete-enumeration APIs, unsafe for
  // partial-enumeration sources.
  {
    label: "historical backfill by source type",
    expected: [
      "Historical events",
      "`GOOGLE_CALENDAR`",
      "`ICAL_FEED`",
      "`MEETUP`",
      "`HARRIER_CENTRAL`",
      "`HASHREGO`",
      "`HTML_SCRAPER`",
      "`GOOGLE_SHEETS`",
      "wider scrape window is **unsafe**",
      "one-shot DB insert",
      "auth-protected",
    ],
  },
  // Schema-gap framing — fields with no visible event-card slot get
  // tagged as schema-gap, not extraction bugs.
  {
    label: "schema-gap framing anchored on event-card visibility",
    expected: [
      "schema gap",
      "visible home on a HashTracks event card",
      "shiggy level",
    ],
  },
  // Verbatim-source contract on filing bodies. Earlier audits
  // synthesized expected values that the adapter couldn't emit.
  {
    label: "verbatim-source contract for Expected/Current values",
    expected: [
      "verbatim text from the source",
      "not** a synthesized cleanup",
      "exact text from the HashTracks page, verbatim",
    ],
  },
  // CTA matches the dialog button label after #1160 kennel-echo change.
  {
    label: "Mark <kennel> complete CTA matching the dialog button",
    expected: ["Mark NYCH3 complete"],
  },
  // Suppressions endpoint reference so deep dives don't re-flag
  // globally-suppressed rules.
  {
    label: "live suppressions endpoint reference",
    expected: [
      "https://hashtracks.xyz/api/audit/suppressions",
      "Active suppressions",
    ],
  },
  // Profile-bundle steering — file ONE bundled issue rather than 5–7
  // micro-issues per field (PR #1116, PR #974, issue #1029).
  {
    label: "profile-bundle steering for ≥2 missing fields",
    expected: [
      "Profile bundle rule",
      "≥2 missing",
      "NYCH3 — Profile bundle:",
      "Don't open separate issues per field",
    ],
  },
  // Root-cause bundling — same artifact across N events → ONE issue.
  {
    label: "root-cause bundling across N events",
    expected: [
      "Root-cause bundle rule",
      "sample event link",
      "not N issues",
    ],
  },
  // Schema-gap field list with #503/#504 cross-references.
  {
    label: "schema-gap field list with #503/#504 cross-references",
    expected: [
      "`endTime`",
      "#504",
      "`cost`",
      "#503",
      "`trailType`",
      "`schema-gap`",
    ],
  },
  // Post-submit reload-and-verify — issue #1160 mitigation; auditor
  // confirms the kennel actually dropped from the queue after Submit.
  {
    label: "post-submit reload-and-verify (issue #1160 mitigation)",
    expected: [
      "hard-reload",
      "no longer in the queue",
      "#1160",
      "do **not** re-submit",
    ],
  },
];

describe("buildDeepDivePrompt", () => {
  it.each(CONTAINS_CASES)("contains $label", ({ expected }) => {
    for (const substring of expected) {
      expect(prompt).toContain(substring);
    }
  });

  it("formats prior deep dive date as ISO date when one is set", () => {
    const dated = buildDeepDivePrompt({
      ...FIXTURE,
      lastDeepDiveAt: new Date("2026-03-15T12:00:00Z"),
    });
    expect(dated).toContain("Last deep dive:** 2026-03-15");
  });

  it("notes when a kennel has no enabled sources", () => {
    const promptWithNoSources = buildDeepDivePrompt({
      ...FIXTURE,
      sources: [],
    });
    expect(promptWithNoSources).toContain("no enabled sources");
  });
});
