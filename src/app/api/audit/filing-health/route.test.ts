import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/github-repo", () => ({
  getValidatedRepo: () => "johnrclem/hashtracks-web",
}));
vi.mock("@/lib/github-app", () => ({ serverGithubAuth: vi.fn() }));

import { GET } from "./route";
import { getAdminUser } from "@/lib/auth";
import { serverGithubAuth, type ServerGithubAuth } from "@/lib/github-app";

const mockedAdmin = vi.mocked(getAdminUser);
const mockedAuth = vi.mocked(serverGithubAuth);

const PAT: ServerGithubAuth = { token: "test-token", source: "pat-fallback", permissions: null };
const APP: ServerGithubAuth = { token: "ghs_app", source: "app", permissions: { issues: "write", metadata: "read" } };

let fetchSpy: ReturnType<typeof vi.spyOn>;

const okRateLimit = (remaining = 4321) =>
  Response.json({
    resources: { core: { limit: 5000, remaining, reset: 9999 } },
  });

const okRepoWithPush = () =>
  Response.json({ permissions: { admin: false, push: true, pull: true } });

beforeEach(() => {
  vi.resetAllMocks();
  fetchSpy = vi.spyOn(globalThis, "fetch");
  // Cast-to-Awaited matches the documented codebase convention but avoids
  // Sonar S4325 by naming the precise expected type instead of `as never`.
  mockedAdmin.mockResolvedValue({ id: "u1" } as Awaited<ReturnType<typeof getAdminUser>>);
  mockedAuth.mockResolvedValue(PAT);
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("GET /api/audit/filing-health", () => {
  it("returns 403 with error payload when no admin session", async () => {
    mockedAdmin.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.status).toBe("error");
  });

  it("reports error when no GitHub credential is configured", async () => {
    mockedAuth.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toMatch(/GITHUB_APP_ID/);
  });

  describe("with the server App", () => {
    it("returns ok when the token works and can write issues", async () => {
      mockedAuth.mockResolvedValueOnce(APP);
      fetchSpy.mockResolvedValueOnce(okRateLimit());
      const body = await (await GET()).json();
      expect(body).toMatchObject({ status: "ok", remaining: 4321, resetAt: 9999 });
      expect(body.message).toMatch(/server App can file issues on johnrclem\/hashtracks-web/);
      // The App's permissions come with its token; no collaborator-role probe.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("returns error when the App can't write issues", async () => {
      mockedAuth.mockResolvedValueOnce({ ...APP, permissions: { issues: "read" } });
      fetchSpy.mockResolvedValueOnce(okRateLimit());
      const body = await (await GET()).json();
      expect(body.status).toBe("error");
      expect(body.message).toMatch(/can't write issues \(issues: read\)/);
    });

    it("returns error when the App fails to mint a token", async () => {
      mockedAuth.mockRejectedValueOnce(new Error("GitHub App POST /app/installations/:id/access_tokens: HTTP 401"));
      const body = await (await GET()).json();
      expect(body.status).toBe("error");
      expect(body.message).toMatch(/server GitHub App failed: .*HTTP 401/);
    });

    it("gives an App-specific hint on a 401", async () => {
      mockedAuth.mockResolvedValueOnce(APP);
      fetchSpy.mockResolvedValueOnce(new Response("Bad credentials", { status: 401 }));
      const body = await (await GET()).json();
      expect(body.message).toMatch(/server App's installation token/);
    });
  });

  it("surfaces a 401 from GitHub as a token-rotation hint", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Bad credentials", { status: 401 }),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toMatch(/Rotate GITHUB_TOKEN/);
  });

  it("returns warn (the owner's PAT fallback) with remaining budget when both probes succeed and token has push", async () => {
    fetchSpy.mockResolvedValueOnce(okRateLimit());
    fetchSpy.mockResolvedValueOnce(okRepoWithPush());
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("warn");
    expect(body.message).toMatch(/GITHUB_TOKEN fallback/);
    expect(body.remaining).toBe(4321);
    expect(body.resetAt).toBe(9999);
    expect(body.message).toMatch(/can write to johnrclem\/hashtracks-web/);
  });

  it("returns warn when remaining budget is dangerously low but token can still write", async () => {
    fetchSpy.mockResolvedValueOnce(okRateLimit(12));
    fetchSpy.mockResolvedValueOnce(okRepoWithPush());
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("warn");
    expect(body.message).toMatch(/Only 12\/5000 core calls remain/);
  });

  // Codex adversarial review on PR #1509: /rate_limit alone could green-light
  // a token that has zero write capability on the target repo. The repo-probe
  // closes that hole by checking `permissions.push`.
  it("returns error when token is valid but lacks push permission on the repo", async () => {
    fetchSpy.mockResolvedValueOnce(okRateLimit());
    fetchSpy.mockResolvedValueOnce(
      Response.json({ permissions: { admin: false, push: false, pull: true } }),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toMatch(/lacks any issue-management role/);
  });

  it("returns error when token has admin permission instead of push", async () => {
    fetchSpy.mockResolvedValueOnce(okRateLimit());
    fetchSpy.mockResolvedValueOnce(
      Response.json({ permissions: { admin: true, push: false, pull: true } }),
    );
    const res = await GET();
    const body = await res.json();
    // admin implies push at the GitHub-API contract level; we accept it (as the fallback).
    expect(body.status).toBe("warn");
    expect(body.message).toMatch(/can write to/);
  });

  // Regression for Codex P1 on PR #1509: fine-grained PATs scoped to
  // `Issues: Read+Write` but `Contents: Read` typically report at the
  // `triage` collaborator level. Such tokens CAN file issues — flagging
  // them as "Filing broken" would be a persistent false alarm.
  it("accepts triage permission (covers fine-grained PATs with Issues:Write)", async () => {
    fetchSpy.mockResolvedValueOnce(okRateLimit());
    fetchSpy.mockResolvedValueOnce(
      Response.json({
        permissions: { admin: false, push: false, triage: true, pull: true },
      }),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("warn");
    expect(body.message).toMatch(/can write to/);
  });

  it("returns error with 404 hint when the repo is invisible to the token", async () => {
    fetchSpy.mockResolvedValueOnce(okRateLimit());
    fetchSpy.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toMatch(/cannot see repo/);
  });

  it("returns error when /repos returns 200 but no permissions block", async () => {
    fetchSpy.mockResolvedValueOnce(okRateLimit());
    fetchSpy.mockResolvedValueOnce(Response.json({ name: "hashtracks-web" }));
    const res = await GET();
    const body = await res.json();
    // No permissions block means we can't confirm write access — fail closed.
    expect(body.status).toBe("error");
    expect(body.message).toMatch(/lacks any issue-management role/);
  });

  // Regression for CodeRabbit/Gemini/Claude-bot reviews on PR #1509:
  // a non-numeric `x-ratelimit-reset` header used to throw RangeError
  // and silently flip the rate-limit response into a generic catch-path
  // error. The guard must keep the actionable rate-limit message.
  it("handles non-numeric x-ratelimit-reset header without throwing", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("rate limited", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "not-a-number",
        },
      }),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toMatch(/rate-limited/);
    // No resets-at suffix when the header is garbage — better than throwing.
    expect(body.message).not.toMatch(/resets at/);
  });
});
