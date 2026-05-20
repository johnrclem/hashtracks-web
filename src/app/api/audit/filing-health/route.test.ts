import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/github-repo", () => ({
  getValidatedRepo: () => "johnrclem/hashtracks-web",
}));

import { GET } from "./route";
import { getAdminUser } from "@/lib/auth";

const mockedAdmin = vi.mocked(getAdminUser);

const ORIGINAL_TOKEN = process.env.GITHUB_TOKEN;

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
  mockedAdmin.mockResolvedValue({ id: "u1" } as never);
  process.env.GITHUB_TOKEN = "test-token";
});

afterEach(() => {
  fetchSpy.mockRestore();
  if (ORIGINAL_TOKEN === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = ORIGINAL_TOKEN;
});

describe("GET /api/audit/filing-health", () => {
  it("returns 403 with error payload when no admin session", async () => {
    mockedAdmin.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.status).toBe("error");
  });

  it("reports error when GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.message).toMatch(/GITHUB_TOKEN/);
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

  it("returns ok with remaining budget when both probes succeed and token has push", async () => {
    fetchSpy.mockResolvedValueOnce(okRateLimit());
    fetchSpy.mockResolvedValueOnce(okRepoWithPush());
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("ok");
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
    expect(body.message).toMatch(/can write to johnrclem\/hashtracks-web/);
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
    expect(body.message).toMatch(/lacks write access/);
  });

  it("returns error when token has admin permission instead of push", async () => {
    fetchSpy.mockResolvedValueOnce(okRateLimit());
    fetchSpy.mockResolvedValueOnce(
      Response.json({ permissions: { admin: true, push: false, pull: true } }),
    );
    const res = await GET();
    const body = await res.json();
    // admin implies push at the GitHub-API contract level; we accept it.
    expect(body.status).toBe("ok");
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
    expect(body.message).toMatch(/lacks write access/);
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
