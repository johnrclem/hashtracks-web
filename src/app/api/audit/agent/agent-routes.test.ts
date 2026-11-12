import { restoreEnv } from "@/test/env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/deep-dive-queue", () => ({ loadDeepDiveQueue: vi.fn() }));
vi.mock("@/lib/admin/hareline-prompt-inputs", () => ({ loadHarelinePromptInputs: vi.fn() }));
vi.mock("@/lib/admin/audit-suppressions-md", () => ({
  renderSuppressionsMarkdown: vi.fn(),
  SUPPRESSIONS_RESPONSE_HEADERS: { "Content-Type": "text/markdown; charset=utf-8" },
}));
vi.mock("@/lib/admin/audit-submit", () => ({ handleAuditSubmission: vi.fn() }));
vi.mock("@/lib/admin/audit-draft-queue", () => ({
  loadQueuedDrafts: vi.fn(),
  discardQueuedDraft: vi.fn(),
}));

import { NextResponse } from "next/server";

import { discardQueuedDraft, loadQueuedDrafts } from "@/lib/admin/audit-draft-queue";
import { handleAuditSubmission } from "@/lib/admin/audit-submit";
import { renderSuppressionsMarkdown } from "@/lib/admin/audit-suppressions-md";
import type { DeepDiveCandidate } from "@/lib/admin/deep-dive-queue";
import { loadDeepDiveQueue } from "@/lib/admin/deep-dive-queue";
import { loadHarelinePromptInputs } from "@/lib/admin/hareline-prompt-inputs";
import { AUDIT_AGENT_SUBMITTER_ID } from "@/lib/audit-agent-auth";
import { POST as discardDraft } from "./drafts/discard/route";
import { GET as getDrafts } from "./drafts/route";
import { GET as getHarelinePrompt } from "./hareline-prompt/route";
import { GET as getNextDeepDive } from "./next-deep-dive/route";
import { POST as submitFinding } from "./submit-finding/route";
import { GET as getSuppressions } from "./suppressions/route";

const TOKEN = "t".repeat(64);
const BASE = "https://www.hashtracks.xyz/api/audit/agent";

const KENNEL: DeepDiveCandidate = {
  kennelCode: "nych3",
  shortName: "NYCH3",
  slug: "nych3",
  region: "New York City, NY",
  lastDeepDiveAt: new Date("2026-07-01T12:00:00Z"),
  eventCount90d: 12,
  sources: [{ type: "ICAL_FEED", url: "https://hashnyc.com/feed.ics", name: "HashNYC Website" }],
};

function get(path: string, token: string | null = TOKEN): Request {
  const headers = new Headers();
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  return new Request(`${BASE}/${path}`, { headers });
}

function post(body: unknown, token: string | null = TOKEN, path = "submit-finding"): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  return new Request(`${BASE}/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

const original = process.env.AUDIT_AGENT_TOKEN;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUDIT_AGENT_TOKEN = TOKEN;
});
afterEach(() => {
  restoreEnv("AUDIT_AGENT_TOKEN", original);
});

describe("agent routes reject requests without the token", () => {
  it.each([
    ["next-deep-dive", () => getNextDeepDive(get("next-deep-dive", null))],
    ["hareline-prompt", () => getHarelinePrompt(get("hareline-prompt", "wrong".repeat(10)))],
    ["suppressions", () => getSuppressions(get("suppressions", null))],
    ["submit-finding", () => submitFinding(post({ kind: "completion" }, null))],
    ["drafts", () => getDrafts(get("drafts", null))],
    ["drafts/discard", () => discardDraft(post({ draftId: "d1", reason: "stale" }, null, "drafts/discard"))],
  ])("%s → 401 and touches no data", async (_label, call) => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(loadDeepDiveQueue).not.toHaveBeenCalled();
    expect(loadHarelinePromptInputs).not.toHaveBeenCalled();
    expect(renderSuppressionsMarkdown).not.toHaveBeenCalled();
    expect(handleAuditSubmission).not.toHaveBeenCalled();
    expect(loadQueuedDrafts).not.toHaveBeenCalled();
    expect(discardQueuedDraft).not.toHaveBeenCalled();
  });
});

describe("GET /api/audit/agent/drafts", () => {
  it("lists queued drafts for one kennel with its short name", async () => {
    vi.mocked(loadQueuedDrafts).mockResolvedValue([
      { id: "d1", ruleSlug: "source-coverage-gap", kennel: { shortName: "NYCH3" } },
    ] as never);
    const res = await getDrafts(get("drafts?kennelCode=nych3&includeBody=1"));
    expect(res.status).toBe(200);
    expect(loadQueuedDrafts).toHaveBeenCalledWith({ kennelCode: "nych3", limit: 100, includeBody: true });
    expect((await res.json()).data).toEqual([
      { id: "d1", ruleSlug: "source-coverage-gap", kennelShortName: "NYCH3" },
    ]);
  });
});

describe("POST /api/audit/agent/drafts/discard", () => {
  const discard = (body: unknown) => discardDraft(post(body, TOKEN, "drafts/discard"));

  it("returns 400 without a draftId and doesn't touch the queue", async () => {
    const res = await discard({ reason: "stale" });
    expect(res.status).toBe(400);
    expect(discardQueuedDraft).not.toHaveBeenCalled();
  });

  it("returns 400 when the reason is rejected", async () => {
    vi.mocked(discardQueuedDraft).mockResolvedValue("invalid-reason");
    const res = await discard({ draftId: "d1", reason: "  " });
    expect(res.status).toBe(400);
    expect((await res.json()).data).toBeNull();
  });

  it("discards as the agent", async () => {
    vi.mocked(discardQueuedDraft).mockResolvedValue("discarded");
    const res = await discard({ draftId: "d1", reason: "stale: fixed in #2900" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { discarded: true } });
    expect(discardQueuedDraft).toHaveBeenCalledWith("d1", "stale: fixed in #2900", "agent");
  });

  it("returns 404 when the draft already left the queue", async () => {
    vi.mocked(discardQueuedDraft).mockResolvedValue("not-queued");
    const res = await discard({ draftId: "gone", reason: "stale" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/audit/agent/next-deep-dive", () => {
  it("returns the head of the queue with an agent-transport prompt", async () => {
    vi.mocked(loadDeepDiveQueue).mockResolvedValue([KENNEL]);
    const res = await getNextDeepDive(get("next-deep-dive"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(loadDeepDiveQueue).toHaveBeenCalledWith(1);
    expect(json.data.kennel).toMatchObject({
      kennelCode: "nych3",
      slug: "nych3",
      lastDeepDiveAt: "2026-07-01T12:00:00.000Z",
      sources: KENNEL.sources,
    });
    expect(json.data.prompt).toContain(`${BASE}/submit-finding`);
    expect(json.data.prompt).toContain("Authorization: Bearer $AUDIT_AGENT_TOKEN");
    expect(json.data.prompt).toContain(`${BASE}/suppressions`);
  });

  it("returns data:null when the queue is empty", async () => {
    vi.mocked(loadDeepDiveQueue).mockResolvedValue([]);
    const res = await getNextDeepDive(get("next-deep-dive"));
    expect(await res.json()).toEqual({ data: null, meta: { reason: "queue-empty" } });
  });
});

describe("GET /api/audit/agent/hareline-prompt", () => {
  it("returns the agent-transport hareline prompt", async () => {
    vi.mocked(loadHarelinePromptInputs).mockResolvedValue({ recentlyFixed: [], focusAreas: [] });
    const res = await getHarelinePrompt(get("hareline-prompt"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.prompt).toContain("Daily Hareline Audit");
    expect(json.data.prompt).toContain(`${BASE}/submit-finding`);
  });
});

describe("GET /api/audit/agent/suppressions", () => {
  it("returns the suppressions markdown", async () => {
    vi.mocked(renderSuppressionsMarkdown).mockResolvedValue("## Active Suppressions\n");
    const res = await getSuppressions(get("suppressions"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toBe("## Active Suppressions\n");
  });
});

describe("POST /api/audit/agent/submit-finding", () => {
  it("returns 400 for a malformed JSON body", async () => {
    const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
    const res = await submitFinding(new Request(`${BASE}/submit-finding`, { method: "POST", headers, body: "{nope" }));
    expect(res.status).toBe(400);
    expect(handleAuditSubmission).not.toHaveBeenCalled();
  });

  it("passes the parsed body to the shared handler as the agent submitter", async () => {
    vi.mocked(handleAuditSubmission).mockResolvedValue(NextResponse.json({ data: { queued: true } }, { status: 201 }));
    const body = { kind: "completion", kennelCode: "nych3", findingsCount: 0, summary: "clean" };
    const res = await submitFinding(post(body));
    expect(res.status).toBe(201);
    expect(handleAuditSubmission).toHaveBeenCalledWith(body, AUDIT_AGENT_SUBMITTER_ID);
  });
});
