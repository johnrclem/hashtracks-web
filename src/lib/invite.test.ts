import { describe, it, expect } from "vitest";
import { generateInviteToken, computeExpiresAt } from "./invite";

describe("generateInviteToken", () => {
  it("returns a 43-character base64url string", () => {
    const token = generateInviteToken();
    // 32 bytes = 43 base64url characters (ceil(32*4/3) = 43, no padding)
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces unique values on consecutive calls", () => {
    const tokens = new Set(Array.from({ length: 10 }, () => generateInviteToken()));
    expect(tokens.size).toBe(10);
  });
});

describe("computeExpiresAt", () => {
  it("returns a date N days from now", () => {
    const before = Date.now();
    const result = computeExpiresAt(7);
    const after = Date.now();

    const expectedMin = before + 7 * 24 * 60 * 60 * 1000;
    const expectedMax = after + 7 * 24 * 60 * 60 * 1000;

    expect(result.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(result.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it("defaults to 7 days", () => {
    const before = Date.now();
    const result = computeExpiresAt();
    const expected = before + 7 * 24 * 60 * 60 * 1000;

    // Within 1 second tolerance
    expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
  });

  it("handles 1-day expiry", () => {
    const before = Date.now();
    const result = computeExpiresAt(1);
    const expected = before + 1 * 24 * 60 * 60 * 1000;

    expect(Math.abs(result.getTime() - expected)).toBeLessThan(1000);
  });
});
