import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { backfillStepUpNonce: { create: vi.fn(), updateMany: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import { checkStepUp, consumeStepUpNonce, mintStepUpNonce, type StepUpBinding } from "./step-up";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const fresh = { fva: [3, 0], iat: NOW / 1000 - 5 };
const ok = (claims: Record<string, unknown> = fresh) => checkStepUp({ clerkStrictMfa: true, claims, nowMs: NOW });

describe("step-up checks (design 10.3, Phase 0 exit)", () => {
  it("passes Clerk's strict_mfa, a second factor this minute and a fresh token", () => {
    expect(ok()).toMatchObject({ ok: true, refusals: [] });
  });

  // Each case passes Clerk's own check: the server's checks must refuse anyway.
  it.each([
    ["no second factor on the account (Clerk downgraded to the first factor)", { ...fresh, fva: [0, -1] }, "no-second-factor"],
    ["fva missing", { iat: fresh.iat }, "fva-missing"],
    ["fva malformed (not a pair)", { ...fresh, fva: [0] }, "fva-malformed"],
    ["fva malformed (strings)", { ...fresh, fva: ["0", "0"] }, "fva-malformed"],
    ["fva malformed (object)", { ...fresh, fva: { 1: 0 } }, "fva-malformed"],
    ["a second factor 1 minute old", { ...fresh, fva: [0, 1] }, "second-factor-stale"],
    ["a second factor 9 minutes old (inside Clerk's window)", { ...fresh, fva: [0, 9] }, "second-factor-stale"],
    ["a token exactly 60 seconds old", { ...fresh, iat: NOW / 1000 - 60 }, "token-stale"],
    ["a token 70 seconds old", { ...fresh, iat: NOW / 1000 - 70 }, "token-stale"],
    ["a token with no iat", { fva: [0, 0] }, "iat-missing"],
    ["a token with a non-numeric iat", { ...fresh, iat: "1700000000" }, "iat-missing"],
    ["a token stamped well in the future", { ...fresh, iat: NOW / 1000 + 30 }, "token-future"],
  ])("refuses %s even when Clerk's check passes", (_label, claims, refusal) => {
    const result = ok(claims);
    expect(result.ok).toBe(false);
    expect(result.refusals).toContain(refusal);
  });

  it("accepts a token up to 5 seconds in the future (Clerk's own skew)", () => {
    expect(ok({ ...fresh, iat: NOW / 1000 + 5 }).ok).toBe(true);
  });

  it("refuses when Clerk's own check fails", () => {
    expect(checkStepUp({ clerkStrictMfa: false, claims: fresh, nowMs: NOW }).refusals).toEqual(["strict-mfa"]);
  });

  it("refuses with no claims at all", () => {
    expect(checkStepUp({ clerkStrictMfa: true, claims: null, nowMs: NOW }).refusals).toEqual(["fva-missing", "iat-missing"]);
  });
});

describe("step-up nonces", () => {
  const binding: StepUpBinding = { clerkSessionId: "sess_1", adminUserId: "user_1", action: "UNDO", runId: "run_1", payloadHash: "h" };

  beforeEach(() => {
    vi.mocked(prisma.backfillStepUpNonce.create).mockResolvedValue({} as never);
  });

  it("mints only when the checks pass, storing a hash bound to session, action, run and payload", async () => {
    expect(await mintStepUpNonce(binding, ok({ ...fresh, fva: [0, 2] }))).toMatchObject({ ok: false });
    expect(prisma.backfillStepUpNonce.create).not.toHaveBeenCalled();
    const minted = await mintStepUpNonce(binding, ok(), new Date(NOW));
    expect(minted.ok).toBe(true);
    const data = vi.mocked(prisma.backfillStepUpNonce.create).mock.calls[0][0].data;
    expect(data).toMatchObject({ clerkSessionId: "sess_1", adminUserId: "user_1", action: "UNDO", runId: "run_1", payloadHash: "h" });
    expect(data.nonceHash).not.toBe(minted.ok && minted.nonce);
    expect((data.expiresAt as Date).getTime() - NOW).toBe(120_000);
  });

  it("refuses a valid nonce sent with a token that fails a check, and spends it", async () => {
    vi.mocked(prisma.backfillStepUpNonce.updateMany).mockResolvedValueOnce({ count: 1 });
    const stale = ok({ ...fresh, iat: NOW / 1000 - 61 });
    expect(await consumeStepUpNonce("n", binding, stale, new Date(NOW))).toMatchObject({ ok: false, reason: "checks" });
    // Spent: the same nonce can't be tried again.
    vi.mocked(prisma.backfillStepUpNonce.updateMany).mockResolvedValueOnce({ count: 0 });
    expect(await consumeStepUpNonce("n", binding, ok(), new Date(NOW))).toEqual({ ok: false, reason: "unknown-or-used" });
  });

  it("uses a nonce only for its own session, action, target and payload", async () => {
    vi.mocked(prisma.backfillStepUpNonce.updateMany).mockResolvedValueOnce({ count: 1 });
    expect(await consumeStepUpNonce("n", binding, ok(), new Date(NOW))).toEqual({ ok: true });
    const where = vi.mocked(prisma.backfillStepUpNonce.updateMany).mock.calls[0][0]!.where;
    expect(where).toMatchObject({ clerkSessionId: "sess_1", adminUserId: "user_1", action: "UNDO", runId: "run_1", kennelId: null, payloadHash: "h", consumedAt: null });
  });
});
