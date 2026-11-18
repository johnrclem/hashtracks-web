import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const has = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ sessionId: "sess_owner", userId: "user_owner", has })),
  verifyToken: vi.fn(),
}));

import { auth, verifyToken } from "@clerk/nextjs/server";
import { serverStepUpChecks, STEP_UP_CLERK_CHECK } from "./step-up-server";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const fresh = { sid: "sess_owner", fva: [30, 0], iat: NOW / 1000 - 3 };

describe("serverStepUpChecks", () => {
  beforeEach(() => {
    vi.stubEnv("OWNER_CLERK_USER_ID", "user_owner");
    has.mockReturnValue(true);
    vi.mocked(verifyToken).mockResolvedValue(fresh as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("passes the owner's fresh token, asking Clerk at the second-factor level", async () => {
    const r = await serverStepUpChecks("tok", NOW);
    expect(r.checks).toMatchObject({ ok: true, refusals: [] });
    expect(has).toHaveBeenCalledWith({ reverification: STEP_UP_CLERK_CHECK });
  });

  it("refuses another admin, and everyone when OWNER_CLERK_USER_ID is unset", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ sessionId: "sess_owner", userId: "user_other", has } as never);
    expect((await serverStepUpChecks("tok", NOW)).checks.refusals).toContain("not-owner");
    vi.stubEnv("OWNER_CLERK_USER_ID", "");
    expect((await serverStepUpChecks("tok", NOW)).checks.refusals).toContain("not-owner");
  });

  it("refuses a token from another session, and one that doesn't verify", async () => {
    vi.mocked(verifyToken).mockResolvedValueOnce({ ...fresh, sid: "sess_other" } as never);
    expect((await serverStepUpChecks("tok", NOW)).checks.refusals).toContain("session-mismatch");
    vi.mocked(verifyToken).mockRejectedValueOnce(new Error("expired"));
    const r = await serverStepUpChecks("tok", NOW);
    expect(r.checks.ok).toBe(false);
    expect(r.checks.refusals).toEqual(expect.arrayContaining(["session-mismatch", "fva-missing", "iat-missing"]));
  });
});
