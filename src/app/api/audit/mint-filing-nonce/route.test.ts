import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { auditFilingNonce: { create: vi.fn() } },
}));
vi.mock("@/lib/site-url", () => ({
  getCanonicalSiteUrl: () => "https://www.hashtracks.xyz",
}));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computePayloadHash, type FilingPayload } from "@/lib/audit-nonce";
import { buildApiPostRequest, type ApiPostInit } from "@/test/audit-request";
import { POST } from "./route";

const mockAdmin = vi.mocked(getAdminUser);
const mockCreate = vi.mocked(prisma.auditFilingNonce.create);

const ROUTE_URL = "https://www.hashtracks.xyz/api/audit/mint-filing-nonce";
const VALID_BODY = {
  kennelCode: "nych3",
  ruleSlug: "hare-url",
  payloadHash: "a".repeat(64),
};

function buildReq(opts: ApiPostInit = {}): Request {
  return buildApiPostRequest(ROUTE_URL, VALID_BODY, opts);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmin.mockResolvedValue({ id: "u_admin", email: "a@b.com" } as never);
  mockCreate.mockResolvedValue({ id: "nonce_1" } as never);
});

describe("POST /api/audit/mint-filing-nonce", () => {
  it("rejects requests with a missing Origin header (CSRF defense)", async () => {
    const res = await POST(buildReq({ origin: null }));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects requests from a foreign origin", async () => {
    const res = await POST(buildReq({ origin: "https://attacker.com" }));
    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers (no Clerk admin session)", async () => {
    mockAdmin.mockResolvedValue(null);
    const res = await POST(buildReq());
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON body", async () => {
    const res = await POST(buildReq({ bodyText: "{ not valid" }));
    expect(res.status).toBe(400);
  });

  it("rejects payloads missing required fields", async () => {
    const res = await POST(
      buildReq({ body: { kennelCode: "nych3", ruleSlug: "hare-url" } }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a non-hex payloadHash", async () => {
    const res = await POST(
      buildReq({ body: { ...VALID_BODY, payloadHash: "not-a-hash" } }),
    );
    expect(res.status).toBe(400);
  });

  it("mints a nonce and persists its hash on the happy path", async () => {
    const res = await POST(buildReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nonce: string };
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]+$/);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const args = mockCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(args.data.adminUserId).toBe("u_admin");
    expect(args.data.kennelCode).toBe("nych3");
    expect(args.data.ruleSlug).toBe("hare-url");
    expect(args.data.payloadHash).toBe(VALID_BODY.payloadHash);
    // nonceHash is sha256 hex (64 lowercase hex chars).
    expect(args.data.nonceHash).toMatch(/^[0-9a-f]{64}$/);
    // Raw nonce never lands in the DB row.
    expect(JSON.stringify(args.data)).not.toContain(body.nonce);
    // expiresAt is a Date in the future.
    expect(args.data.expiresAt).toBeInstanceOf(Date);
    expect((args.data.expiresAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("sets Cache-Control: no-store so admin-bound nonces don't get cached", async () => {
    const res = await POST(buildReq());
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  describe("canonical-fields shape (chrome prompt path)", () => {
    // 5c-C added a second request shape so chrome agents don't have
    // to compute SHA-256 client-side. Server computes the hash from
    // the canonical fields and persists it the same as the
    // pre-hashed shape. Same security envelope at consume time.
    const CANONICAL_BODY = {
      stream: "CHROME_KENNEL" as const,
      kennelCode: "nych3",
      ruleSlug: "hare-url",
      title: "NYCH3: hare field is a URL",
      eventIds: ["evt-1", "evt-2"],
      bodyMarkdown: "## Finding\n\nDetails go here.",
    };

    it("accepts canonical fields and computes payloadHash server-side", async () => {
      const res = await POST(buildReq({ body: CANONICAL_BODY }));
      expect(res.status).toBe(200);

      // The persisted payloadHash must equal what the server-side
      // helper computes from the same fields, so the file-finding
      // endpoint's recompute-and-verify works end-to-end.
      const expected: FilingPayload = {
        stream: CANONICAL_BODY.stream,
        kennelCode: CANONICAL_BODY.kennelCode,
        ruleSlug: CANONICAL_BODY.ruleSlug,
        title: CANONICAL_BODY.title,
        eventIds: CANONICAL_BODY.eventIds,
        bodyMarkdown: CANONICAL_BODY.bodyMarkdown,
      };
      const args = mockCreate.mock.calls[0][0] as {
        data: { payloadHash: string };
      };
      expect(args.data.payloadHash).toBe(computePayloadHash(expected));
    });

    it("rejects canonical-fields requests missing eventIds", async () => {
      const { eventIds: _eventIds, ...withoutEventIds } = CANONICAL_BODY;
      const res = await POST(buildReq({ body: withoutEventIds }));
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("rejects unsupported stream values", async () => {
      const res = await POST(
        buildReq({ body: { ...CANONICAL_BODY, stream: "AUTOMATED" } }),
      );
      expect(res.status).toBe(400);
    });
  });
});
