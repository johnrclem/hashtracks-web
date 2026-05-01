import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    auditFilingNonce: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditIssue: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/site-url", () => ({
  getCanonicalSiteUrl: () => "https://www.hashtracks.xyz",
}));
vi.mock("@/lib/github-repo", () => ({
  getValidatedRepo: () => "johnrclem/hashtracks-web",
}));
vi.mock("@/generated/prisma/client", () => ({
  AuditStream: {
    AUTOMATED: "AUTOMATED",
    CHROME_EVENT: "CHROME_EVENT",
    CHROME_KENNEL: "CHROME_KENNEL",
    UNKNOWN: "UNKNOWN",
  },
}));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computePayloadHash, type FilingPayload } from "@/lib/audit-nonce";
import { buildApiPostRequest, type ApiPostInit } from "@/test/audit-request";
import { POST } from "./route";

const mockAdmin = vi.mocked(getAdminUser);
const mockFindNonce = vi.mocked(prisma.auditFilingNonce.findUnique);
const mockUpdateNonce = vi.mocked(prisma.auditFilingNonce.update);
const mockFindIssue = vi.mocked(prisma.auditIssue.findFirst);

/** Build a valid nonce row that passes all bind checks. */
function nonceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "nonce_id_1",
    nonceHash: "doesnt-matter-for-tests",
    adminUserId: "u_admin",
    kennelCode: "nych3",
    ruleSlug: "hare-url",
    payloadHash: payloadHashFor(VALID_REQUEST),
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
    filingResultJson: null,
    createdAt: new Date(),
    ...overrides,
  };
}

const ROUTE_URL = "https://www.hashtracks.xyz/api/audit/file-finding";
const VALID_REQUEST = {
  nonce: "valid-nonce",
  stream: "CHROME_KENNEL" as const,
  kennelCode: "nych3",
  ruleSlug: "hare-url",
  eventIds: ["evt-1", "evt-2"],
  title: "Finding: NYCH3 hare-url",
  bodyMarkdown: "## NYCH3 — hare-url\n\nDetails go here.",
};

function payloadHashFor(req: typeof VALID_REQUEST): string {
  const payload: FilingPayload = {
    stream: req.stream,
    kennelCode: req.kennelCode,
    ruleSlug: req.ruleSlug,
    title: req.title,
    eventIds: req.eventIds,
    bodyMarkdown: req.bodyMarkdown,
  };
  return computePayloadHash(payload);
}

function buildReq(opts: ApiPostInit = {}): Request {
  return buildApiPostRequest(ROUTE_URL, VALID_REQUEST, opts);
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  process.env.GITHUB_TOKEN = "ghp_test";
  mockAdmin.mockResolvedValue({ id: "u_admin", email: "a@b.com" } as never);
  mockFindNonce.mockResolvedValue(nonceRow() as never);
  mockUpdateNonce.mockResolvedValue({} as never);
  mockFindIssue.mockResolvedValue(null);
});

describe("POST /api/audit/file-finding", () => {
  it("rejects foreign origins (CSRF)", async () => {
    const res = await POST(buildReq({ origin: "https://attacker.com" }));
    expect(res.status).toBe(403);
    expect(mockFindNonce).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers", async () => {
    mockAdmin.mockResolvedValue(null);
    const res = await POST(buildReq());
    expect(res.status).toBe(401);
    expect(mockFindNonce).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const res = await POST(buildReq({ bodyText: "{ not json" }));
    expect(res.status).toBe(400);
  });

  it("rejects unsupported stream values (AUTOMATED filings come from cron, not here)", async () => {
    const res = await POST(buildReq({ body: { ...VALID_REQUEST, stream: "AUTOMATED" } }));
    expect(res.status).toBe(400);
  });

  it("rejects when the nonce row doesn't exist", async () => {
    mockFindNonce.mockResolvedValue(null);
    const res = await POST(buildReq());
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when the nonce row is expired", async () => {
    mockFindNonce.mockResolvedValue(
      nonceRow({ expiresAt: new Date(Date.now() - 1000) }) as never,
    );
    const res = await POST(buildReq());
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when adminUserId / kennelCode / ruleSlug bound on the row don't match", async () => {
    mockFindNonce.mockResolvedValue(
      nonceRow({ adminUserId: "different-admin" }) as never,
    );
    const res = await POST(buildReq());
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when the recomputed payloadHash mismatches (body-tamper detection)", async () => {
    // Title (or body) was changed post-mint. The bound payloadHash
    // on the row covers (stream, kennel, rule, title, eventIds, body)
    // — Codex pass-2 added title to defeat the title-substitution
    // attack. Mismatch returns 401, no GitHub call.
    mockFindNonce.mockResolvedValue(
      nonceRow({ payloadHash: "x".repeat(64) }) as never,
    );
    const res = await POST(buildReq());
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the cached filingResultJson on retry (idempotency cache)", async () => {
    // After a successful filing, the row's filingResultJson holds
    // the outcome. Retries with the same nonce return the cached
    // value rather than making a second GitHub call. Codex pass-2
    // finding: without this, a transient GitHub failure burns the
    // nonce and the next retry returns 401, dropping the finding.
    const cachedResult = {
      action: "created",
      issueUrl: "https://github.com/x/y/issues/123",
      issueNumber: 123,
    };
    mockFindNonce.mockResolvedValue(
      nonceRow({ filingResultJson: cachedResult, consumedAt: new Date() }) as never,
    );
    const res = await POST(buildReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(cachedResult);
    // Critical: no GitHub call, no AuditIssue lookup — cache short-circuits.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockFindIssue).not.toHaveBeenCalled();
  });

  it("coalesces against an existing AuditIssue with the same fingerprint", async () => {
    // Existing issue carries the same fingerprint (set by the cron path
    // or a prior chrome filing). File-finding should comment, not open.
    mockFindIssue.mockResolvedValue({
      githubNumber: 42,
      htmlUrl: "https://github.com/johnrclem/hashtracks-web/issues/42",
    } as never);
    // GitHub's POST .../comments returns the created comment object;
    // mock includes json() to match the shared `githubApiPost` helper.
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });

    const res = await POST(buildReq());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { action: string; existingIssueNumber: number };
    expect(json.action).toBe("coalesced");
    expect(json.existingIssueNumber).toBe(42);

    // Posted a comment, not a new issue.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/issues/42/comments");
  });

  it("returns 502 when the coalesce-comment call fails — refuses to fork a duplicate", async () => {
    // Codex pass-2 finding: falling through to createGithubIssue when
    // an existing fingerprint match's comment fails would split the
    // finding's history across two open issues for the same defect.
    // The endpoint must instead return a retryable 502 with the
    // existing issue number so the caller can retry (or open the
    // existing issue manually).
    mockFindIssue.mockResolvedValue({
      githubNumber: 42,
      htmlUrl: "https://github.com/x/y/issues/42",
    } as never);
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });

    const res = await POST(buildReq());
    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: string; existingIssueNumber: number };
    expect(json.existingIssueNumber).toBe(42);
    // Only one fetch attempted (the failed comment); no fresh-issue create.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a new GitHub issue with stream + kennel labels and embedded canonical block", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ html_url: "https://github.com/x/y/issues/77", number: 77 }),
    });

    const res = await POST(buildReq());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { action: string; issueNumber: number };
    expect(json.action).toBe("created");
    expect(json.issueNumber).toBe(77);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/issues");
    const init = fetchMock.mock.calls[0][1] as { body: string };
    const requestBody = JSON.parse(init.body) as {
      title: string;
      body: string;
      labels: string[];
    };
    expect(requestBody.title).toBe(VALID_REQUEST.title);
    expect(requestBody.body).toContain(VALID_REQUEST.bodyMarkdown);
    // Canonical block is embedded so the sync mirror can populate
    // AuditIssue.fingerprint on its next run (matches PR #1172).
    expect(requestBody.body).toContain("<!-- audit-canonical:");
    expect(requestBody.labels).toContain("audit");
    expect(requestBody.labels).toContain("alert");
    expect(requestBody.labels).toContain("audit:chrome-kennel");
    expect(requestBody.labels).toContain("kennel:nych3");
  });

  it("returns 502 when GitHub issue creation fails", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const res = await POST(buildReq());
    expect(res.status).toBe(502);
  });

  it("does not look up an existing issue by fingerprint for non-fingerprintable rules", async () => {
    // `hare-cta-text` is one of the imperative-only rules — buildCanonicalBlock
    // returns undefined. File-finding skips coalescing and goes straight to
    // creating a fresh issue. Mock the nonce row to bind that ruleSlug
    // and the matching payloadHash so the body-tamper guard passes.
    const req = { ...VALID_REQUEST, ruleSlug: "hare-cta-text" };
    mockFindNonce.mockResolvedValue(
      nonceRow({
        ruleSlug: "hare-cta-text",
        payloadHash: payloadHashFor(req),
      }) as never,
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ html_url: "https://github.com/x/y/issues/55", number: 55 }),
    });

    const res = await POST(buildReq({ body: req }));
    expect(res.status).toBe(200);

    expect(mockFindIssue).not.toHaveBeenCalled();
    // Body should NOT contain a canonical block since the rule isn't
    // fingerprintable (registry returned undefined).
    const init = fetchMock.mock.calls[0][1] as { body: string };
    const reqBody = JSON.parse(init.body) as { body: string };
    expect(reqBody.body).not.toContain("<!-- audit-canonical:");
  });
});
