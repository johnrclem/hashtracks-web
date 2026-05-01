/**
 * Parity test: each fingerprintable rule in `rule-definitions.ts`
 * must produce the same accept/reject decision as the existing
 * imperative check in `audit-checks.ts` for the same input row.
 *
 * Bundle 4b only populates the registry — runtime check-running still
 * goes through the imperative path. This test locks the data
 * migration in: if a registry rule's pattern drifts from its
 * imperative twin, the corpus diverges and CI fails.
 */

import { evaluate } from "@/lib/audit-evaluator";
import { AUDIT_RULES } from "./rule-registry";
import { runChecks } from "./audit-runner";
import type { AuditEventRow } from "./audit-checks";
import { buildAuditEventRow } from "@/test/factories";

/**
 * For each rule slug, list rows that should match (positive) and rows
 * that should not (negative). The parity test verifies both the
 * imperative path and the registry-evaluator agree on every case.
 *
 * Drawn from the actual audit issues that motivated each rule (issue
 * numbers in comments) so the corpus stays grounded in real failure
 * modes.
 */
const PARITY_FIXTURES: ReadonlyArray<{
  slug: string;
  positives: AuditEventRow[];
  negatives: AuditEventRow[];
}> = [
  {
    slug: "hare-single-char",
    positives: [buildAuditEventRow({ haresText: "X" })],
    negatives: [
      buildAuditEventRow({ haresText: "Frank" }),
      buildAuditEventRow({ haresText: null }),
      buildAuditEventRow({ haresText: "" }),
    ],
  },
  {
    slug: "hare-url",
    positives: [
      buildAuditEventRow({ haresText: "https://example.com/hare" }),
      buildAuditEventRow({ haresText: "http://example.com/hare" }),
    ],
    negatives: [
      buildAuditEventRow({ haresText: "Frank" }),
      // Mid-string URL doesn't fire — only leading-URL is the bug shape.
      buildAuditEventRow({ haresText: "see https://example.com" }),
      buildAuditEventRow({ haresText: null }),
    ],
  },
  {
    slug: "hare-description-leak",
    positives: [buildAuditEventRow({ haresText: "x".repeat(201) })],
    negatives: [
      buildAuditEventRow({ haresText: "x".repeat(200) }),
      buildAuditEventRow({ haresText: "Frank, BareGain, Just Bob" }),
      buildAuditEventRow({ haresText: null }),
    ],
  },
  {
    slug: "hare-phone-number",
    positives: [
      // separated forms (issue #742)
      buildAuditEventRow({ haresText: "Frank (415) 555-1212" }),
      buildAuditEventRow({ haresText: "Frank 415.555.1212" }),
      buildAuditEventRow({ haresText: "Frank 415-555-1212" }),
      // bare 10-digit run (issue #809)
      buildAuditEventRow({ haresText: "2406185563" }),
    ],
    negatives: [
      buildAuditEventRow({ haresText: "Frank, Just Bob" }),
      buildAuditEventRow({ haresText: null }),
    ],
  },
  {
    slug: "hare-boilerplate-leak",
    positives: [
      // Each substring used to leak from real source pages (#777). Imperative
      // `checkHareQuality` returns on first match (`hare-cta-text` would fire
      // before boilerplate for "Hares Needed" strings), so fixtures here
      // avoid CTA-shaped text — slug membership is what the parity test asserts.
      buildAuditEventRow({ haresText: "Frank Location: Central Park" }),
      buildAuditEventRow({ haresText: "BareGain HASH CASH: $5" }),
      buildAuditEventRow({ haresText: "Just Bob Trail Type: Live" }),
    ],
    negatives: [
      buildAuditEventRow({ haresText: "Frank, BareGain" }),
      buildAuditEventRow({ haresText: null }),
    ],
  },
  {
    slug: "title-cta-text",
    positives: [
      buildAuditEventRow({ title: "Wanna hare? Sign up here" }),
      buildAuditEventRow({ title: "Available dates for hares" }),
      buildAuditEventRow({ title: "Hares needed for Friday" }), // CTA_EMBEDDED
      buildAuditEventRow({ title: "Looking for a hare" }),
    ],
    negatives: [
      buildAuditEventRow({ title: "NYCH3 #1234 — Frank's run" }),
      buildAuditEventRow({ title: null }),
    ],
  },
  {
    slug: "title-schedule-description",
    positives: [
      buildAuditEventRow({ title: "Runs on the first Tuesday" }),
      buildAuditEventRow({ title: "Meets every Saturday" }),
      buildAuditEventRow({ title: "Runs every Tuesday" }),
    ],
    negatives: [
      buildAuditEventRow({ title: "NYCH3 #1234 — Frank's run" }),
      buildAuditEventRow({ title: null }),
    ],
  },
  {
    slug: "title-html-entities",
    positives: [
      buildAuditEventRow({ title: "Frank&apos;s run" }),
      buildAuditEventRow({ title: "Trail &amp; trail" }),
      buildAuditEventRow({ title: "&#39;Boozy&#39;" }),
      buildAuditEventRow({ title: "&#x2014; em dash" }),
    ],
    negatives: [
      buildAuditEventRow({ title: "Frank's run" }),
      buildAuditEventRow({ title: null }),
    ],
  },
  {
    slug: "title-time-only",
    positives: [
      buildAuditEventRow({ title: "7:00 PM" }),
      buildAuditEventRow({ title: "7 AM" }),
      buildAuditEventRow({ title: "19:00" }),
    ],
    negatives: [
      buildAuditEventRow({ title: "NYCH3 #1234 7:00 PM" }),
      buildAuditEventRow({ title: null }),
    ],
  },
  {
    slug: "location-url",
    positives: [
      buildAuditEventRow({ locationName: "https://maps.google.com/..." }),
      buildAuditEventRow({ locationName: "http://meetup.com/foo" }),
    ],
    negatives: [
      buildAuditEventRow({ locationName: "Central Park, NYC" }),
      buildAuditEventRow({ locationName: null }),
    ],
  },
  {
    slug: "location-phone-number",
    positives: [
      // (issue #743)
      buildAuditEventRow({
        locationName: "text Assover at 919-332-2615 for address",
      }),
      buildAuditEventRow({ locationName: "9193326015 for address" }),
    ],
    negatives: [
      buildAuditEventRow({ locationName: "Central Park, NYC" }),
      buildAuditEventRow({ locationName: null }),
    ],
  },
  {
    slug: "location-email-cta",
    positives: [
      // (issue #798 ABQ H3)
      buildAuditEventRow({
        locationName: "Inquire for location: abqh3misman@gmail.com",
      }),
      buildAuditEventRow({
        locationName: "Email contact@example.com for address",
      }),
    ],
    negatives: [
      buildAuditEventRow({ locationName: "Central Park, NYC" }),
      buildAuditEventRow({ locationName: null }),
    ],
  },
];

/** Imperative-path slugs reported for a single row, via the existing
 *  `runChecks` orchestrator from audit-runner. */
function imperativeSlugs(row: AuditEventRow): string[] {
  return runChecks([row]).map((f) => f.rule);
}

describe("rule-definitions parity with audit-checks", () => {
  it("every fixture slug exists in AUDIT_RULES", () => {
    for (const fx of PARITY_FIXTURES) {
      expect(AUDIT_RULES.has(fx.slug)).toBe(true);
    }
  });

  describe.each(PARITY_FIXTURES)("$slug", ({ slug, positives, negatives }) => {
    const rule = AUDIT_RULES.get(slug);

    it("rule exists in registry", () => {
      expect(rule).toBeDefined();
    });

    it.each(positives.map((row, i) => [i, row] as const))(
      "positive case #%i: registry evaluator AND imperative check both fire",
      (_i, row) => {
        expect(rule).toBeDefined();
        if (!rule) return;
        // AuditEventRow is structurally a NormalizedRow (the latter is a
        // Pick<> of the former) — pass directly, no projection needed.
        expect(evaluate(rule.matcher, row)).toBe(true);
        expect(imperativeSlugs(row)).toContain(slug);
      },
    );

    it.each(negatives.map((row, i) => [i, row] as const))(
      "negative case #%i: neither path fires",
      (_i, row) => {
        expect(rule).toBeDefined();
        if (!rule) return;
        expect(evaluate(rule.matcher, row)).toBe(false);
        expect(imperativeSlugs(row)).not.toContain(slug);
      },
    );
  });
});
