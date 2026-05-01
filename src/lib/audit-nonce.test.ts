import {
  generateNonce,
  hashNonce,
  computePayloadHash,
  computeNonceExpiresAt,
  isValidOrigin,
  NONCE_TTL_MS,
  type FilingPayload,
} from "./audit-nonce";

describe("generateNonce", () => {
  it("produces URL-safe base64 strings", () => {
    const n = generateNonce();
    expect(n).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("emits unique values across calls (collision check)", () => {
    const set = new Set();
    for (let i = 0; i < 100; i++) set.add(generateNonce());
    expect(set.size).toBe(100);
  });
});

describe("hashNonce", () => {
  it("returns 64-char hex sha256", () => {
    expect(hashNonce("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    expect(hashNonce("nonce-1")).toBe(hashNonce("nonce-1"));
  });

  it("changes when the input changes", () => {
    expect(hashNonce("a")).not.toBe(hashNonce("b"));
  });
});

const SAMPLE_PAYLOAD: FilingPayload = {
  stream: "CHROME_KENNEL",
  kennelCode: "nych3",
  ruleSlug: "hare-url",
  title: "NYCH3: hare field is a URL",
  eventIds: ["evt-1", "evt-2", "evt-3"],
  bodyMarkdown: "## Finding\n\nDetails go here.",
};

describe("computePayloadHash", () => {
  it("returns 64-char hex sha256", () => {
    expect(computePayloadHash(SAMPLE_PAYLOAD)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical payloads", () => {
    expect(computePayloadHash(SAMPLE_PAYLOAD)).toBe(computePayloadHash(SAMPLE_PAYLOAD));
  });

  it("sorts eventIds before hashing — order-insensitive", () => {
    // Mint and consume can submit eventIds in different orders; the
    // hash must agree so the round-trip succeeds.
    const reordered = computePayloadHash({
      ...SAMPLE_PAYLOAD,
      eventIds: ["evt-3", "evt-1", "evt-2"],
    });
    expect(reordered).toBe(computePayloadHash(SAMPLE_PAYLOAD));
  });

  it("differs when any bound field changes (stream / kennelCode / ruleSlug / title / body)", () => {
    expect(
      computePayloadHash({ ...SAMPLE_PAYLOAD, stream: "CHROME_EVENT" }),
    ).not.toBe(computePayloadHash(SAMPLE_PAYLOAD));
    expect(
      computePayloadHash({ ...SAMPLE_PAYLOAD, kennelCode: "other-kennel" }),
    ).not.toBe(computePayloadHash(SAMPLE_PAYLOAD));
    expect(
      computePayloadHash({ ...SAMPLE_PAYLOAD, ruleSlug: "title-cta-text" }),
    ).not.toBe(computePayloadHash(SAMPLE_PAYLOAD));
    // Title binding (Codex pass-2 finding): caller holding a valid
    // nonce can't substitute a different GitHub-issue title at consume
    // time, since the title participates in the hash.
    expect(
      computePayloadHash({ ...SAMPLE_PAYLOAD, title: "Different misleading title" }),
    ).not.toBe(computePayloadHash(SAMPLE_PAYLOAD));
    expect(
      computePayloadHash({ ...SAMPLE_PAYLOAD, bodyMarkdown: "Different prose." }),
    ).not.toBe(computePayloadHash(SAMPLE_PAYLOAD));
  });

  it("differs when eventIds membership changes (not just order)", () => {
    expect(
      computePayloadHash({ ...SAMPLE_PAYLOAD, eventIds: ["evt-1", "evt-2"] }),
    ).not.toBe(computePayloadHash(SAMPLE_PAYLOAD));
    expect(
      computePayloadHash({ ...SAMPLE_PAYLOAD, eventIds: [...SAMPLE_PAYLOAD.eventIds, "evt-4"] }),
    ).not.toBe(computePayloadHash(SAMPLE_PAYLOAD));
  });

  it("survives newline injection — bodyMarkdown containing the join delimiter doesn't collide", () => {
    // The canonical encoding joins fields with `\n`. A bodyMarkdown
    // containing `\n` is normal markdown and shouldn't allow forging
    // a different (kennelCode, ruleSlug, …) tuple by absorbing the
    // delimiter. bodyMarkdown is the LAST field so trailing
    // newlines just extend the payload — no field swaps possible.
    const innocuous = computePayloadHash(SAMPLE_PAYLOAD);
    const withTrailingNewline = computePayloadHash({
      ...SAMPLE_PAYLOAD,
      bodyMarkdown: SAMPLE_PAYLOAD.bodyMarkdown + "\nextra paragraph",
    });
    expect(innocuous).not.toBe(withTrailingNewline);
  });
});

describe("computeNonceExpiresAt", () => {
  it("defaults to NONCE_TTL_MS in the future", () => {
    const before = Date.now();
    const exp = computeNonceExpiresAt();
    const after = Date.now();
    expect(exp.getTime()).toBeGreaterThanOrEqual(before + NONCE_TTL_MS);
    expect(exp.getTime()).toBeLessThanOrEqual(after + NONCE_TTL_MS);
  });

  it("honors an explicit ttl override", () => {
    const exp = computeNonceExpiresAt(60 * 1000); // 1 minute
    expect(exp.getTime()).toBeLessThan(Date.now() + 90 * 1000);
  });
});

describe("isValidOrigin", () => {
  it("returns true for the canonical site URL", () => {
    expect(isValidOrigin("https://www.hashtracks.xyz")).toBe(true);
  });

  it("rejects null/missing Origin headers", () => {
    expect(isValidOrigin(null)).toBe(false);
    expect(isValidOrigin("")).toBe(false);
  });

  it("rejects malformed Origin values", () => {
    expect(isValidOrigin("not-a-url")).toBe(false);
  });

  it("rejects an attacker origin even when it ends with the canonical hostname", () => {
    // `www.hashtracks.xyz.attacker.com` mustn't pass; we compare full
    // origin (scheme + hostname + port), not substring.
    expect(isValidOrigin("https://www.hashtracks.xyz.attacker.com")).toBe(false);
  });

  it("rejects a different scheme on the same hostname", () => {
    expect(isValidOrigin("http://www.hashtracks.xyz")).toBe(false);
  });
});
