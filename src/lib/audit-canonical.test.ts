import {
  emitCanonicalBlock,
  parseCanonicalBlock,
  buildCanonicalBlock,
  CANONICAL_SCHEMA_VERSION,
  type CanonicalBlock,
} from "./audit-canonical";

const SAMPLE: Omit<CanonicalBlock, "v"> = {
  stream: "AUTOMATED",
  kennelCode: "nych3",
  ruleSlug: "hare-url",
  ruleVersion: 1,
  semanticHash: "a".repeat(64),
  fingerprint: "b".repeat(64),
};

describe("emitCanonicalBlock", () => {
  it("wraps the JSON payload in the HTML-comment envelope", () => {
    const block = emitCanonicalBlock(SAMPLE);
    expect(block.startsWith("<!-- audit-canonical:")).toBe(true);
    expect(block.endsWith("-->")).toBe(true);
  });

  it("includes the schema version so older readers can fail closed", () => {
    expect(emitCanonicalBlock(SAMPLE)).toContain(`"v":${CANONICAL_SCHEMA_VERSION}`);
  });

  it("preserves all required fields verbatim", () => {
    const block = emitCanonicalBlock(SAMPLE);
    expect(block).toContain('"stream":"AUTOMATED"');
    expect(block).toContain('"kennelCode":"nych3"');
    expect(block).toContain('"ruleSlug":"hare-url"');
    expect(block).toContain('"ruleVersion":1');
  });

  it("escapes `-->` inside string fields so the comment envelope can't be terminated early", () => {
    // Kennel codes are slug-shaped today, but defensively a future
    // payload field could contain `-->` and would otherwise truncate
    // the comment block. Mirrors the same defense in auto-issue.ts.
    const block = emitCanonicalBlock({
      ...SAMPLE,
      kennelCode: "weird-->code",
    });
    // The literal `-->` should appear only ONCE: the closing
    // delimiter. Inside the JSON, it gets escaped to `--&gt;`.
    expect(block.split("-->")).toHaveLength(2);
    expect(block).toContain("weird--&gt;code");
  });
});

describe("buildCanonicalBlock", () => {
  it("returns a populated block for a fingerprintable registry rule", () => {
    const block = buildCanonicalBlock({
      stream: "AUTOMATED",
      kennelCode: "nych3",
      ruleSlug: "hare-url",
    });
    expect(block).toBeDefined();
    expect(block?.kennelCode).toBe("nych3");
    expect(block?.ruleSlug).toBe("hare-url");
    expect(block?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(block?.semanticHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns undefined for a slug not in the registry", () => {
    // The 5 imperative-only rules (e.g. hare-cta-text) don't have
    // registry entries — caller falls back to filing without a block.
    expect(
      buildCanonicalBlock({
        stream: "AUTOMATED",
        kennelCode: "nych3",
        ruleSlug: "hare-cta-text",
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a slug that doesn't exist at all", () => {
    expect(
      buildCanonicalBlock({
        stream: "AUTOMATED",
        kennelCode: "nych3",
        ruleSlug: "fictional-rule-that-does-not-exist",
      }),
    ).toBeUndefined();
  });

  it("produces the same fingerprint regardless of stream — that's the cross-stream coalescing invariant", () => {
    const fromCron = buildCanonicalBlock({
      stream: "AUTOMATED",
      kennelCode: "nych3",
      ruleSlug: "hare-url",
    });
    const fromChrome = buildCanonicalBlock({
      stream: "CHROME_KENNEL",
      kennelCode: "nych3",
      ruleSlug: "hare-url",
    });
    // Same (kennel, rule) → same fingerprint, even though `stream`
    // is recorded differently in each block. Same defect surfaced
    // by different streams must coalesce on the same fingerprint
    // for the bridging tier to merge them.
    expect(fromCron?.fingerprint).toBe(fromChrome?.fingerprint);
    expect(fromCron?.semanticHash).toBe(fromChrome?.semanticHash);
  });
});

describe("parseCanonicalBlock", () => {
  it("round-trips emit → parse losslessly", () => {
    const block = emitCanonicalBlock(SAMPLE);
    expect(parseCanonicalBlock(block)).toEqual({
      v: CANONICAL_SCHEMA_VERSION,
      ...SAMPLE,
    });
  });

  it("extracts the block when surrounded by other markdown content", () => {
    const body = [
      "## Sample Events",
      "- some link",
      "## Fix Guidance",
      "Some prose.",
      emitCanonicalBlock(SAMPLE),
    ].join("\n");
    expect(parseCanonicalBlock(body)).toEqual({
      v: CANONICAL_SCHEMA_VERSION,
      ...SAMPLE,
    });
  });

  it("returns null when the body has no canonical block", () => {
    expect(parseCanonicalBlock("Just some markdown.")).toBeNull();
  });

  it("returns null on null/undefined/empty body", () => {
    expect(parseCanonicalBlock(null)).toBeNull();
    expect(parseCanonicalBlock(undefined)).toBeNull();
    expect(parseCanonicalBlock("")).toBeNull();
  });

  it("returns null when the JSON payload is malformed", () => {
    const broken = "<!-- audit-canonical: { not valid json } -->";
    expect(parseCanonicalBlock(broken)).toBeNull();
  });

  it("returns null when the schema version does not match", () => {
    // Future readers fail closed on newer-format blocks rather than
    // silently misinterpret unknown shapes.
    const future = '<!-- audit-canonical: {"v":99,"stream":"AUTOMATED","kennelCode":"nych3","ruleSlug":"hare-url","ruleVersion":1,"semanticHash":"x","fingerprint":"y"} -->';
    expect(parseCanonicalBlock(future)).toBeNull();
  });

  it("returns null when a required field is missing", () => {
    // Missing `fingerprint`. A partial match must fail closed so the
    // bridging tier can claim the row instead of populating a bogus
    // fingerprint.
    const partial = '<!-- audit-canonical: {"v":1,"stream":"AUTOMATED","kennelCode":"nych3","ruleSlug":"hare-url","ruleVersion":1,"semanticHash":"x"} -->';
    expect(parseCanonicalBlock(partial)).toBeNull();
  });

  it("returns null when stream is not a known AuditStream value", () => {
    const badStream = '<!-- audit-canonical: {"v":1,"stream":"NOT_A_STREAM","kennelCode":"nych3","ruleSlug":"hare-url","ruleVersion":1,"semanticHash":"x","fingerprint":"y"} -->';
    expect(parseCanonicalBlock(badStream)).toBeNull();
  });

  it("round-trips the `-->` escape — emit's `--&gt;` is unescaped on parse", () => {
    // Without the symmetric unescape, kennelCodes containing `-->`
    // would be silently corrupted: emit produces `weird--&gt;code`
    // inside the JSON, parse extracts that literal string instead
    // of the original (Gemini PR #1172 review feedback).
    const block = emitCanonicalBlock({ ...SAMPLE, kennelCode: "weird-->code" });
    expect(parseCanonicalBlock(block)?.kennelCode).toBe("weird-->code");
  });

  it("takes the first block when the body contains multiple", () => {
    // Defensive: shouldn't happen in normal flow but if it does,
    // first-wins is more predictable than last-wins.
    const body = [
      emitCanonicalBlock(SAMPLE),
      emitCanonicalBlock({ ...SAMPLE, kennelCode: "different-kennel" }),
    ].join("\n");
    expect(parseCanonicalBlock(body)?.kennelCode).toBe("nych3");
  });
});
