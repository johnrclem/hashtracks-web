import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  computeQueueSnapshotId,
  signQueueToken,
  verifyQueueToken,
  computeQueueTokenExpiresAt,
  mintQueueTokens,
  QUEUE_TOKEN_TTL_MS,
} from "./queue-snapshot-token";

const ORIGINAL_SECRET = process.env.AUDIT_QUEUE_TOKEN_SECRET;

beforeEach(() => {
  process.env.AUDIT_QUEUE_TOKEN_SECRET = "test-secret-for-deep-dive-tokens";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.AUDIT_QUEUE_TOKEN_SECRET;
  } else {
    process.env.AUDIT_QUEUE_TOKEN_SECRET = ORIGINAL_SECRET;
  }
});

describe("computeQueueSnapshotId", () => {
  it("returns a 64-char hex SHA-256", () => {
    expect(computeQueueSnapshotId(["a", "b", "c"])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is order-insensitive: same kennelCodes in different order → same hash", () => {
    // Cosmetic reorders (e.g. operator drags rows around the queue
    // panel) shouldn't invalidate tokens — only insertions and
    // removals should.
    expect(computeQueueSnapshotId(["nych3", "philly-h3", "agnews"])).toBe(
      computeQueueSnapshotId(["agnews", "nych3", "philly-h3"]),
    );
  });

  it("changes when a kennel is added", () => {
    const before = computeQueueSnapshotId(["nych3", "philly-h3"]);
    const after = computeQueueSnapshotId(["nych3", "philly-h3", "agnews"]);
    expect(before).not.toBe(after);
  });

  it("changes when a kennel is removed", () => {
    const before = computeQueueSnapshotId(["nych3", "philly-h3", "agnews"]);
    const after = computeQueueSnapshotId(["nych3", "philly-h3"]);
    expect(before).not.toBe(after);
  });

  it("differs from a prefix-collision attempt", () => {
    // `["ab", "c"]` joined with "\n" → "ab\nc"; `["a", "bc"]` joined → "a\nbc".
    // Both are 4 chars but with the delimiter in different positions.
    // Hash must distinguish them.
    expect(computeQueueSnapshotId(["ab", "c"])).not.toBe(
      computeQueueSnapshotId(["a", "bc"]),
    );
  });
});

describe("signQueueToken / verifyQueueToken round trip", () => {
  it("verifies a freshly-signed token", () => {
    const token = signQueueToken({
      kennelCode: "nych3",
      queueSnapshotId: "a".repeat(64),
      expiresAt: computeQueueTokenExpiresAt(),
    });
    const result = verifyQueueToken(token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.kennelCode).toBe("nych3");
    expect(result.payload.queueSnapshotId).toBe("a".repeat(64));
  });

  it("rejects a token with a tampered payload (signature mismatch)", () => {
    const token = signQueueToken({
      kennelCode: "nych3",
      queueSnapshotId: "a".repeat(64),
      expiresAt: computeQueueTokenExpiresAt(),
    });
    // Decode payload, swap kennelCode, re-encode without re-signing.
    const [payloadB64, mac] = token.split(".");
    const decoded = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as { kennelCode: string };
    decoded.kennelCode = "different-kennel";
    const tampered = `${Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url")}.${mac}`;
    const result = verifyQueueToken(tampered);
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("rejects a token with a tampered MAC", () => {
    const token = signQueueToken({
      kennelCode: "nych3",
      queueSnapshotId: "a".repeat(64),
      expiresAt: computeQueueTokenExpiresAt(),
    });
    // Flip the last hex char of the MAC.
    const tampered =
      token.slice(0, -1) + (token.slice(-1) === "0" ? "1" : "0");
    const result = verifyQueueToken(tampered);
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("rejects an expired token", () => {
    const token = signQueueToken({
      kennelCode: "nych3",
      queueSnapshotId: "a".repeat(64),
      expiresAt: Date.now() - 1000, // already expired
    });
    const result = verifyQueueToken(token);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token with no dot separator", () => {
    expect(verifyQueueToken("not-a-token")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects a same-length non-hex MAC without throwing (Codex bundle 6 finding)", () => {
    // `Buffer.from("not-hex", "hex")` silently truncates, which
    // would slip past the length check and crash `timingSafeEqual`
    // — turning attacker-controlled input into a 500 path.
    // Pre-validating hex shape returns invalid-signature instead.
    const valid = signQueueToken({
      kennelCode: "nych3",
      queueSnapshotId: "a".repeat(64),
      expiresAt: computeQueueTokenExpiresAt(),
    });
    const [payloadB64, validMac] = valid.split(".");
    // Replace the MAC with a same-length string of non-hex chars.
    const nonHexMac = "z".repeat(validMac.length);
    const tampered = `${payloadB64}.${nonHexMac}`;
    expect(() => verifyQueueToken(tampered)).not.toThrow();
    expect(verifyQueueToken(tampered)).toEqual({
      ok: false,
      reason: "invalid-signature",
    });
  });

  it("rejects a token signed with a different secret", () => {
    const token = signQueueToken({
      kennelCode: "nych3",
      queueSnapshotId: "a".repeat(64),
      expiresAt: computeQueueTokenExpiresAt(),
    });
    process.env.AUDIT_QUEUE_TOKEN_SECRET = "different-secret";
    const result = verifyQueueToken(token);
    expect(result).toEqual({ ok: false, reason: "invalid-signature" });
  });
});

describe("computeQueueTokenExpiresAt", () => {
  it("defaults to QUEUE_TOKEN_TTL_MS in the future", () => {
    const before = Date.now();
    const exp = computeQueueTokenExpiresAt();
    const after = Date.now();
    expect(exp).toBeGreaterThanOrEqual(before + QUEUE_TOKEN_TTL_MS);
    expect(exp).toBeLessThanOrEqual(after + QUEUE_TOKEN_TTL_MS);
  });

  it("honors an explicit ttl override", () => {
    const exp = computeQueueTokenExpiresAt(60_000);
    expect(exp).toBeLessThan(Date.now() + 90_000);
  });
});

describe("mintQueueTokens", () => {
  it("returns one verifiable token per kennelCode sharing the same snapshot", () => {
    const codes = ["nych3", "philly-h3", "agnews"];
    const tokens = mintQueueTokens(codes);
    expect(Object.keys(tokens).sort()).toEqual([...codes].sort());

    const expectedSnapshot = computeQueueSnapshotId(codes);
    for (const code of codes) {
      const minted = tokens[code];
      expect(minted).toBeDefined();
      if (!minted) continue;
      const result = verifyQueueToken(minted.token);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.payload.kennelCode).toBe(code);
      expect(result.payload.queueSnapshotId).toBe(expectedSnapshot);
      expect(minted.expiresAt).toBe(result.payload.expiresAt);
    }
  });

  it("returns the same snapshot regardless of input order", () => {
    const a = mintQueueTokens(["nych3", "philly-h3", "agnews"]);
    const b = mintQueueTokens(["agnews", "nych3", "philly-h3"]);
    const aMinted = a.nych3;
    const bMinted = b.nych3;
    expect(aMinted && bMinted).toBeDefined();
    if (!aMinted || !bMinted) return;
    const aResult = verifyQueueToken(aMinted.token);
    const bResult = verifyQueueToken(bMinted.token);
    expect(aResult.ok && bResult.ok).toBe(true);
    if (!aResult.ok || !bResult.ok) return;
    expect(aResult.payload.queueSnapshotId).toBe(
      bResult.payload.queueSnapshotId,
    );
  });

  it("returns {} for an empty input", () => {
    expect(mintQueueTokens([])).toEqual({});
  });

  it("returns {} when the secret is missing instead of throwing (page must still render)", () => {
    delete process.env.AUDIT_QUEUE_TOKEN_SECRET;
    expect(mintQueueTokens(["nych3"])).toEqual({});
  });

  it("stamps expiresAt at QUEUE_TOKEN_TTL_MS in the future so callers can detect staleness", () => {
    // Codex flagged a no-ship: the dialog accepts prefetchedToken
    // unconditionally, so a tab idle past the TTL submits an expired
    // token. The mint side returns expiresAt; the dialog gates on
    // `expiresAt - Date.now() > buffer` to fall back to async fetch.
    const before = Date.now();
    const tokens = mintQueueTokens(["nych3"]);
    const after = Date.now();
    const minted = tokens.nych3;
    expect(minted).toBeDefined();
    if (!minted) return;
    expect(minted.expiresAt).toBeGreaterThanOrEqual(before + QUEUE_TOKEN_TTL_MS);
    expect(minted.expiresAt).toBeLessThanOrEqual(after + QUEUE_TOKEN_TTL_MS);
  });
});

describe("getSecret error path", () => {
  it("throws when AUDIT_QUEUE_TOKEN_SECRET is unset (defense against silent default)", () => {
    delete process.env.AUDIT_QUEUE_TOKEN_SECRET;
    expect(() =>
      signQueueToken({
        kennelCode: "nych3",
        queueSnapshotId: "a".repeat(64),
        expiresAt: computeQueueTokenExpiresAt(),
      }),
    ).toThrow(/AUDIT_QUEUE_TOKEN_SECRET/);
  });
});
