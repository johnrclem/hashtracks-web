import { describe, expect, it, vi } from "vitest";

import { createOpsGithub, GithubUnavailableError, isWaitingOnOwner, type GhPull } from "./ops-github";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("createOpsGithub", () => {
  it("lists issues and PRs by label, newest first, with PR fields", async () => {
    const fetchMock = vi.fn(async () =>
      json([
        { number: 7, title: "t", body: null, labels: [{ name: "audit-fix" }], created_at: "2026-11-13T17:18:43Z", closed_at: null, draft: false, pull_request: { merged_at: null } },
        { number: 8, title: "u", body: "b", labels: ["lane:ops"], created_at: "2026-11-14T00:00:00Z", closed_at: "2026-11-15T00:00:00Z" },
      ]),
    );
    const gh = createOpsGithub("tok", fetchMock as never);
    const issues = await gh.listIssues({ labels: "audit-fix", state: "all", limit: 5 });

    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.origin).toBe("https://api.github.com");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      labels: "audit-fix",
      state: "all",
      sort: "created",
      direction: "desc",
      per_page: "5",
      page: "1",
    });
    expect(issues[0]).toMatchObject({ number: 7, body: "", labels: ["audit-fix"], pull: { mergedAt: null, draft: false } });
    expect(issues[1]).toMatchObject({ number: 8, pull: null, closedAt: new Date("2026-11-15T00:00:00Z") });
  });

  it("pages until a short page", async () => {
    const page = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ number: from + i, head: { sha: "s" }, created_at: "2026-11-01T00:00:00Z" }));
    const fetchMock = vi.fn().mockResolvedValueOnce(json(page(100, 1))).mockResolvedValueOnce(json(page(3, 101)));
    const pulls = await createOpsGithub("tok", fetchMock as never).listOpenPulls();
    expect(pulls).toHaveLength(103);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("parses comment issue numbers and bot authors", async () => {
    const fetchMock = vi.fn(async () =>
      json([
        { issue_url: "https://api.github.com/repos/o/r/issues/2901", created_at: "2026-11-17T01:00:00Z", body: "x", user: { type: "Bot" } },
        { issue_url: "garbage", created_at: "2026-11-17T01:00:00Z", body: "y", user: { type: "User" } },
      ]),
    );
    const comments = await createOpsGithub("tok", fetchMock as never).listIssueComments(new Date("2026-11-10T00:00:00Z"));
    expect(comments).toEqual([{ issueNumber: 2901, createdAt: new Date("2026-11-17T01:00:00Z"), body: "x", byBot: true }]);
  });

  it("fails loudly on HTTP errors, timeouts and non-list bodies", async () => {
    await expect(createOpsGithub("tok", vi.fn(async () => json({}, 502)) as never).listOpenPulls()).rejects.toThrow(
      GithubUnavailableError,
    );
    await expect(
      createOpsGithub("tok", vi.fn(async () => Promise.reject(new Error("timeout"))) as never).listOpenPulls(),
    ).rejects.toThrow(/timeout/);
    await expect(createOpsGithub("tok", vi.fn(async () => json({ message: "x" })) as never).listOpenPulls()).rejects.toThrow(
      /not a list/,
    );
  });

  it("creates, comments on and closes issues", async () => {
    const fetchMock = vi.fn(async () => json({ number: 4100 }, 201));
    const gh = createOpsGithub("tok", fetchMock as never);
    expect(await gh.createIssue({ title: "t", body: "b", labels: ["lane:ops"] })).toBe(4100);
    await gh.comment(4100, "recovered");
    await gh.close(4100);
    const calls = fetchMock.mock.calls as unknown as Array<[URL, RequestInit]>;
    expect(calls.map(([url, init]) => [init.method, url.pathname, JSON.parse(String(init.body))])).toEqual([
      ["POST", "/repos/johnrclem/hashtracks-web/issues", { title: "t", body: "b", labels: ["lane:ops"] }],
      ["POST", "/repos/johnrclem/hashtracks-web/issues/4100/comments", { body: "recovered" }],
      ["PATCH", "/repos/johnrclem/hashtracks-web/issues/4100", { state: "closed", state_reason: "completed" }],
    ]);
  });
});

describe("isWaitingOnOwner", () => {
  const pr = (labels: string[], draft = false) => ({ labels, draft }) as GhPull;
  it("is an open, non-draft PR not yet approved and not a self-merged handoff", () => {
    expect(isWaitingOnOwner(pr([]))).toBe(true);
    expect(isWaitingOnOwner(pr(["audit-fix"]))).toBe(true);
    expect(isWaitingOnOwner(pr(["audit-fix", "owner-approved"]))).toBe(false);
    expect(isWaitingOnOwner(pr(["onboarding-handoff"]))).toBe(false);
    expect(isWaitingOnOwner(pr([], true))).toBe(false);
  });
});
