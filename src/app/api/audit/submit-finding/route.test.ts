import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findUnique: vi.fn() },
    auditFindingDraft: { create: vi.fn(), findFirst: vi.fn() },
    auditLog: { findFirst: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/lib/site-url", () => ({
  getCanonicalSiteUrl: () => "https://www.hashtracks.xyz",
}));
vi.mock("@/lib/prisma-errors", () => ({
  isUniqueConstraintViolation: vi.fn(() => false),
}));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isUniqueConstraintViolation } from "@/lib/prisma-errors";
import { buildApiPostRequest } from "@/test/audit-request";
import { POST } from "./route";

const mockAdmin = vi.mocked(getAdminUser);
const mockKennel = vi.mocked(prisma.kennel.findUnique);
const mockDraftCreate = vi.mocked(prisma.auditFindingDraft.create);
const mockDraftFindFirst = vi.mocked(prisma.auditFindingDraft.findFirst);
const mockLogFindFirst = vi.mocked(prisma.auditLog.findFirst);
const mockLogCreate = vi.mocked(prisma.auditLog.create);
const mockIsUnique = vi.mocked(isUniqueConstraintViolation);

const URL = "https://www.hashtracks.xyz/api/audit/submit-finding";

const VALID_FINDING = {
  kind: "finding",
  stream: "CHROME_EVENT",
  kennelCode: "nych3",
  ruleSlug: "hares-theme-leak",
  title: "NYCH3 hares column shows theme text",
  eventIds: ["evt_1"],
  bodyMarkdown: "The hares field contains the trail theme, not hare names.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmin.mockResolvedValue({ id: "admin_1" } as never);
  mockKennel.mockResolvedValue({ kennelCode: "nych3" } as never);
  mockIsUnique.mockReturnValue(false);
});

describe("POST /api/audit/submit-finding — auth", () => {
  it("403 on missing Origin", async () => {
    const res = await POST(buildApiPostRequest(URL, VALID_FINDING, { origin: null }));
    expect(res.status).toBe(403);
  });

  it("401 when not an admin", async () => {
    mockAdmin.mockResolvedValue(null as never);
    const res = await POST(buildApiPostRequest(URL, VALID_FINDING));
    expect(res.status).toBe(401);
  });

  it("400 on malformed JSON", async () => {
    const res = await POST(buildApiPostRequest(URL, undefined, { bodyText: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("400 on an unrecognized kind", async () => {
    const res = await POST(buildApiPostRequest(URL, { kind: "nope" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/audit/submit-finding — finding", () => {
  it("queues a PENDING draft and never touches GitHub / AuditLog", async () => {
    mockDraftCreate.mockResolvedValue({ id: "draft_1" } as never);
    const res = await POST(buildApiPostRequest(URL, VALID_FINDING));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data).toMatchObject({ queued: true, draftId: "draft_1", deduped: false });
    expect(mockDraftCreate).toHaveBeenCalledTimes(1);
    expect(mockLogCreate).not.toHaveBeenCalled(); // no completion side effect
  });

  it("422 on an unknown kennelCode", async () => {
    mockKennel.mockResolvedValue(null as never);
    const res = await POST(buildApiPostRequest(URL, VALID_FINDING));
    expect(res.status).toBe(422);
    expect(mockDraftCreate).not.toHaveBeenCalled();
  });

  it("400 on a malformed ruleSlug", async () => {
    const res = await POST(
      buildApiPostRequest(URL, { ...VALID_FINDING, ruleSlug: "Not A Slug!" }),
    );
    expect(res.status).toBe(400);
    expect(mockDraftCreate).not.toHaveBeenCalled();
  });

  it("is idempotent on a duplicate submit (partial-unique violation → deduped)", async () => {
    mockDraftCreate.mockRejectedValue(new Error("unique violation") as never);
    mockIsUnique.mockReturnValue(true);
    mockDraftFindFirst.mockResolvedValue({ id: "draft_existing" } as never);
    const res = await POST(buildApiPostRequest(URL, VALID_FINDING));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ queued: true, draftId: "draft_existing", deduped: true });
  });
});

describe("POST /api/audit/submit-finding — completion", () => {
  const COMPLETION = { kind: "completion", kennelCode: "nych3", findingsCount: 3, summary: "All clean except hares." };

  it("records a KENNEL_DEEP_DIVE AuditLog (advances the rotation, no GitHub)", async () => {
    mockLogFindFirst.mockResolvedValue(null as never);
    mockLogCreate.mockResolvedValue({ id: "log_1" } as never);
    const res = await POST(buildApiPostRequest(URL, COMPLETION));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ recorded: true, deepDive: "recorded" });
    expect(mockLogCreate).toHaveBeenCalledTimes(1);
  });

  it("is idempotent same-day (returns already-recorded, no new row)", async () => {
    mockLogFindFirst.mockResolvedValue({ id: "log_existing" } as never);
    const res = await POST(buildApiPostRequest(URL, COMPLETION));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ recorded: true, deepDive: "already-recorded" });
    expect(mockLogCreate).not.toHaveBeenCalled();
  });

  it("422 on an unknown kennelCode", async () => {
    mockKennel.mockResolvedValue(null as never);
    const res = await POST(buildApiPostRequest(URL, COMPLETION));
    expect(res.status).toBe(422);
    expect(mockLogCreate).not.toHaveBeenCalled();
  });
});
