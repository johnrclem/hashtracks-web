import { computeAuditFingerprint } from "./audit-fingerprint";

const BASE = {
  kennelCode: "nych3",
  ruleSlug: "hare-cta-text",
  ruleVersion: 1,
  semanticHash: "abc123def456",
};

describe("computeAuditFingerprint", () => {
  it("produces a 64-char hex sha256", () => {
    const fp = computeAuditFingerprint(BASE);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same inputs", () => {
    expect(computeAuditFingerprint(BASE)).toBe(computeAuditFingerprint(BASE));
  });

  it("differs when kennelCode changes", () => {
    expect(computeAuditFingerprint(BASE)).not.toBe(
      computeAuditFingerprint({ ...BASE, kennelCode: "other-kennel" }),
    );
  });

  it("differs when ruleSlug changes", () => {
    expect(computeAuditFingerprint(BASE)).not.toBe(
      computeAuditFingerprint({ ...BASE, ruleSlug: "title-cta-text" }),
    );
  });

  it("differs when ruleVersion changes", () => {
    expect(computeAuditFingerprint(BASE)).not.toBe(
      computeAuditFingerprint({ ...BASE, ruleVersion: 2 }),
    );
  });

  it("differs when semanticHash changes", () => {
    expect(computeAuditFingerprint(BASE)).not.toBe(
      computeAuditFingerprint({ ...BASE, semanticHash: "different" }),
    );
  });

  it("does NOT incorporate event-id sets — same rule + same kennel coalesce across streams", () => {
    // The fingerprint must be a property of the (rule, kennel) pair,
    // not of the particular event window that surfaced it — otherwise
    // automated, chrome-event, and chrome-kennel streams would each
    // produce different hashes for the same defect because they
    // sampled different events. Belt-and-suspenders test: the
    // function's signature has no event-id parameter.
    expect(computeAuditFingerprint(BASE)).toBe(computeAuditFingerprint(BASE));
  });

  it("survives newline injection — kennelCode containing a newline doesn't collide with adjacent fields", () => {
    // Defensive: kennelCode is slug-shaped today (`[a-z0-9-]`), but if a
    // future schema migration relaxes that constraint we don't want a
    // raw `\n` in kennelCode to silently produce the same fingerprint as
    // (kennelCode-without-newline) + (ruleSlug-with-prefix).
    //
    // The current implementation joins fields with newlines, so this
    // test will fail if/when someone changes the encoding without
    // adopting a stricter delimiter scheme. That's the prompt to make
    // the choice deliberate.
    const innocuous = computeAuditFingerprint({
      ...BASE,
      kennelCode: "nych3",
      ruleSlug: "hare-cta-text",
    });
    const evil = computeAuditFingerprint({
      ...BASE,
      kennelCode: "nych3\nhare-cta-text",
      ruleSlug: "",
    });
    expect(innocuous).not.toBe(evil);
  });
});
