import { describe, it, expect, vi } from "vitest";
import { isApprovalStamp, namesPr, ownerGithubLogin, stampDescription } from "./approval-stamp";
import {
  checkMergedPrApproval,
  checkOpenPrApproval,
  fetchPrFiles,
  LabelMissingError,
  RetryableApprovalError,
  TerminalApprovalError,
  type FetchLike,
} from "./approval";

const H = "a".repeat(40);
const M = "b".repeat(40);
const S = "c".repeat(40);
const D = "d".repeat(40);
/** The main commit the PR merged into (S's first parent). */
const F = "f".repeat(40);
const LABELED_AT = "2026-11-10T10:00:00Z";

interface World {
  pr: Record<string, unknown>;
  events: unknown[];
  commits: Array<{ sha: string }>;
  statuses: Record<string, unknown[]>;
  compare: Record<string, unknown>;
  files: Array<{ filename: string; status: string }>;
  contents: Record<string, string>;
}

function world(overrides: Partial<World> = {}): World {
  return {
    pr: { number: 7, state: "closed", merged: true, merge_commit_sha: S, head: { sha: H, repo: { full_name: "johnrclem/hashtracks-web" } }, base: { ref: "main", sha: F }, labels: [{ name: "owner-approved" }] },
    events: [{ event: "labeled", label: { name: "owner-approved" }, actor: { login: "johnrclem" }, created_at: LABELED_AT }],
    commits: [{ sha: H }],
    statuses: { [H]: [{ context: "backfill/approved", state: "success", description: "Approved by owner for PR #7", creator: { login: "github-actions[bot]" }, created_at: "2026-11-10T10:00:05Z" }] },
    compare: { [`${S}...${D}`]: { status: "ahead" } },
    files: [],
    contents: {},
    ...overrides,
  };
}

function fake(w: World): FetchLike {
  return async (url) => {
    const path = new URL(url).pathname.replace("/repos/johnrclem/hashtracks-web", "");
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (path === "/pulls/7") return json(w.pr);
    if (path === "/issues/7/events") return json(w.events);
    if (path === "/pulls/7/commits") return json(w.commits);
    if (path === "/pulls/7/files") return json(w.files);
    if (path === `/commits/${S}`) return json({ parents: [{ sha: F }, { sha: H }] });
    const status = /^\/commits\/(\w+)\/statuses$/.exec(path);
    if (status) return json(w.statuses[status[1]] ?? []);
    const cmp = /^\/compare\/(.+)$/.exec(path);
    if (cmp && w.compare[cmp[1]]) return json(w.compare[cmp[1]]);
    const file = /^\/contents\/(.+)$/.exec(path);
    if (file && w.contents[file[1]] !== undefined) return new Response(w.contents[file[1]], { status: 200 });
    return new Response("{}", { status: 404 });
  };
}

const ctx = (w: World) => ({ token: "t", fetchImpl: fake(w) });

describe("approval A1–A4 (design 6.4)", () => {
  it("passes a merged PR whose head is the stamped head", async () => {
    expect(await checkMergedPrApproval(7, D, ctx(world()))).toEqual({ prNumber: 7, stampedSha: H, headSha: H, mergeSha: S });
  });

  it("A1: an unmerged PR or a deploy without the merge is retryable", async () => {
    await expect(checkMergedPrApproval(7, D, ctx(world({ pr: { ...world().pr, merged: false } })))).rejects.toBeInstanceOf(RetryableApprovalError);
    await expect(checkMergedPrApproval(7, D, ctx(world({ compare: { [`${S}...${D}`]: { status: "behind" } } })))).rejects.toThrow(/A1/);
    await expect(checkMergedPrApproval(7, null, ctx(world()))).rejects.toBeInstanceOf(RetryableApprovalError);
  });

  it("A2: a label added by anyone but the owner is terminal; no label is retryable", async () => {
    const byBot = world({ events: [{ event: "labeled", label: { name: "owner-approved" }, actor: { login: "hashtracks-bot" }, created_at: LABELED_AT }] });
    await expect(checkMergedPrApproval(7, D, ctx(byBot))).rejects.toBeInstanceOf(TerminalApprovalError);
    await expect(checkMergedPrApproval(7, D, ctx(world({ pr: { ...world().pr, labels: [] } })))).rejects.toBeInstanceOf(RetryableApprovalError);
  });

  it("A3: a missing stamp is retryable; a forged-looking or stale stamp is not accepted", async () => {
    await expect(checkMergedPrApproval(7, D, ctx(world({ statuses: {} })))).rejects.toBeInstanceOf(RetryableApprovalError);
    const notActions = world({ statuses: { [H]: [{ context: "backfill/approved", state: "success", description: "PR #7", creator: { login: "johnrclem" }, created_at: "2026-11-10T10:00:05Z" }] } });
    await expect(checkMergedPrApproval(7, D, ctx(notActions))).rejects.toBeInstanceOf(RetryableApprovalError);
    const otherPr = world({ statuses: { [H]: [{ context: "backfill/approved", state: "success", description: "PR #8", creator: { login: "github-actions[bot]" }, created_at: "2026-11-10T10:00:05Z" }] } });
    await expect(checkMergedPrApproval(7, D, ctx(otherPr))).rejects.toBeInstanceOf(RetryableApprovalError);
    const beforeLabel = world({ statuses: { [H]: [{ context: "backfill/approved", state: "success", description: "PR #7", creator: { login: "github-actions[bot]" }, created_at: "2026-11-09T00:00:00Z" }] } });
    await expect(checkMergedPrApproval(7, D, ctx(beforeLabel))).rejects.toBeInstanceOf(TerminalApprovalError);
  });

  const mergeOfMain = (patchAtHead: string) =>
    world({
      pr: { ...world().pr, head: { sha: M, repo: { full_name: "johnrclem/hashtracks-web" } } },
      commits: [{ sha: H }, { sha: M }],
      compare: {
        [`${S}...${D}`]: { status: "ahead" },
        [`${H}...${M}`]: { status: "ahead", commits: [{ sha: M, parents: [{ sha: H }, { sha: "e".repeat(40) }] }] },
        [`${F}...${H}`]: { files: [{ filename: "prisma/migrations/x/migration.sql", status: "added", sha: "1", patch: "@@ -0,0 +1 @@\n+INSERT 1" }] },
        [`${F}...${M}`]: { files: [{ filename: "prisma/migrations/x/migration.sql", status: "added", sha: "2", patch: patchAtHead }] },
      },
    });

  it("A4: accepts a merge of main that leaves the PR's own lines unchanged", async () => {
    expect((await checkMergedPrApproval(7, D, ctx(mergeOfMain("@@ -0,0 +1,1 @@\n+INSERT 1")))).stampedSha).toBe(H);
  });

  it("A4: refuses a change to the PR's own lines after the stamp, and a non-merge commit", async () => {
    await expect(checkMergedPrApproval(7, D, ctx(mergeOfMain("@@ -0,0 +1 @@\n+INSERT 2")))).rejects.toBeInstanceOf(TerminalApprovalError);
    const w = mergeOfMain("@@ -0,0 +1 @@\n+INSERT 1");
    w.compare[`${H}...${M}`] = { status: "ahead", commits: [{ sha: M, parents: [{ sha: H }] }] };
    await expect(checkMergedPrApproval(7, D, ctx(w))).rejects.toThrow(/isn't a merge/);
  });

  it("A4: accepts ordinary main commits that a merge brings in (only the first-parent chain must be merges)", async () => {
    const w = mergeOfMain("@@ -0,0 +1 @@\n+INSERT 1");
    const E = "e".repeat(40);
    // The compare lists main's own commit E too: it isn't on the PR's first-parent chain.
    w.compare[`${H}...${M}`] = { status: "ahead", commits: [{ sha: E, parents: [{ sha: F }] }, { sha: M, parents: [{ sha: H }, { sha: E }] }] };
    expect((await checkMergedPrApproval(7, D, ctx(w))).stampedSha).toBe(H);
  });

  it("A4: refuses a compare GitHub may have cut short", async () => {
    const w = mergeOfMain("@@ -0,0 +1 @@\n+INSERT 1");
    const many = Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}`, status: "added", sha: "1" }));
    w.compare[`${F}...${H}`] = { files: many };
    w.compare[`${F}...${M}`] = { files: many };
    await expect(checkMergedPrApproval(7, D, ctx(w))).rejects.toThrow(/too many to compare/);
  });

  it("refuses a merged PR from a fork, or from a deleted fork", async () => {
    const fork = world({ pr: { ...world().pr, head: { sha: H, repo: { full_name: "someone/fork" } } } });
    await expect(checkMergedPrApproval(7, D, ctx(fork))).rejects.toBeInstanceOf(TerminalApprovalError);
    const deleted = world({ pr: { ...world().pr, head: { sha: H, repo: null } } });
    await expect(checkMergedPrApproval(7, D, ctx(deleted))).rejects.toBeInstanceOf(TerminalApprovalError);
  });

  it("a list longer than 30 pages is retryable, never read in part", async () => {
    const w = world({ events: Array.from({ length: 100 }, () => ({ event: "commented", created_at: LABELED_AT })) });
    await expect(checkMergedPrApproval(7, D, ctx(w))).rejects.toThrow(/more than 3000 items/);
  });

  it("the open-PR check returns the approved head for --match-head-commit, and refuses a fork", async () => {
    const open = world({ pr: { ...world().pr, merged: false, merge_commit_sha: null } });
    expect(await checkOpenPrApproval(7, ctx(open))).toMatchObject({ stampedSha: H, headSha: H, mergeSha: null });
    const fork = world({ pr: { ...world().pr, head: { sha: H, repo: { full_name: "someone/fork" } } } });
    await expect(checkOpenPrApproval(7, ctx(fork))).rejects.toBeInstanceOf(TerminalApprovalError);
  });

  it("A3: a stamp for #77 isn't a stamp for #7", async () => {
    const w = world({ statuses: { [H]: [{ context: "backfill/approved", state: "success", description: "Approved by the owner for PR #77", creator: { login: "github-actions[bot]" }, created_at: "2026-11-10T10:00:05Z" }] } });
    await expect(checkMergedPrApproval(7, D, ctx(w))).rejects.toThrow(/no stamp yet/);
  });

  it("A2: a missing label is LabelMissingError (it halts a run that's applying)", async () => {
    await expect(checkMergedPrApproval(7, D, ctx(world({ pr: { ...world().pr, labels: [] } })))).rejects.toBeInstanceOf(LabelMissingError);
  });

  it("A3: a stamp older than a label added in the last 15 minutes is retryable", async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const w = world({ events: [{ event: "labeled", label: { name: "owner-approved" }, actor: { login: "johnrclem" }, created_at: recent }] });
    await expect(checkMergedPrApproval(7, D, ctx(w))).rejects.toBeInstanceOf(RetryableApprovalError);
  });

  it("fails retryably without the read token", async () => {
    const saved = process.env.GITHUB_APPROVAL_READ_TOKEN;
    delete process.env.GITHUB_APPROVAL_READ_TOKEN;
    await expect(checkMergedPrApproval(7, D, { fetchImpl: fake(world()) })).rejects.toBeInstanceOf(RetryableApprovalError);
    if (saved !== undefined) process.env.GITHUB_APPROVAL_READ_TOKEN = saved;
  });
});

describe("fetchPrFiles", () => {
  it("reads exactly one manifest, its archive and the added migrations at the ref", async () => {
    const w = world({
      files: [
        { filename: "scripts/data/zh4-history.json", status: "added" },
        { filename: "scripts/data/zh4-history.manifest.json", status: "added" },
        { filename: "prisma/migrations/20990101_onboard_zh4/migration.sql", status: "added" },
        { filename: "prisma/seed-data/sources.ts", status: "modified" },
      ],
      contents: {
        "scripts/data/zh4-history.manifest.json": JSON.stringify({ archivePath: "scripts/data/zh4-history.json" }),
        "scripts/data/zh4-history.json": "[]",
        "prisma/migrations/20990101_onboard_zh4/migration.sql": "BEGIN; COMMIT;",
      },
    });
    const files = await fetchPrFiles(7, S, ctx(w));
    expect(files).toMatchObject({ manifestPath: "scripts/data/zh4-history.manifest.json", archiveBytes: "[]", migrationSql: ["BEGIN; COMMIT;"] });
    expect(files.changedFiles).toHaveLength(4);
  });

  it("refuses two manifests and an archive path outside scripts/data", async () => {
    const two = world({ files: [{ filename: "scripts/data/a-history.manifest.json", status: "added" }, { filename: "scripts/data/b-history.manifest.json", status: "added" }] });
    await expect(fetchPrFiles(7, S, ctx(two))).rejects.toThrow(/A5/);
    const outside = world({
      files: [{ filename: "scripts/data/a-history.manifest.json", status: "added" }],
      contents: { "scripts/data/a-history.manifest.json": JSON.stringify({ archivePath: "../../.env" }) },
    });
    await expect(fetchPrFiles(7, S, ctx(outside))).rejects.toThrow(/outside scripts\/data/);
  });
});

describe("approval stamp module (design 6.3)", () => {
  it("the workflow's description passes the server's check for that PR only", () => {
    const stamp = { context: "backfill/approved", state: "success", description: stampDescription(12), creator: { login: "github-actions[bot]" } };
    expect(isApprovalStamp(stamp, 12)).toBe(true);
    expect(isApprovalStamp(stamp, 1)).toBe(false);
    expect(namesPr("#123", 12)).toBe(false);
  });

  it("reads the owner's login from OWNER_GITHUB_LOGIN, defaulting to the repo owner", () => {
    vi.stubEnv("OWNER_GITHUB_LOGIN", "");
    expect(ownerGithubLogin()).toBe("johnrclem");
    vi.stubEnv("OWNER_GITHUB_LOGIN", "someone");
    expect(ownerGithubLogin()).toBe("someone");
    vi.unstubAllEnvs();
  });
});
