import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/github-repo", () => ({
  getValidatedRepo: () => "johnrclem/hashtracks-web",
}));

import { GET } from "./route";
import { getAdminUser } from "@/lib/auth";

const mockedAdmin = vi.mocked(getAdminUser);

const ORIGINAL_TOKEN = process.env.GITHUB_TOKEN;

let fetchSpy: ReturnType<typeof vi.spyOn>;

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

  it("returns ok with remaining budget when the token works", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json({
        resources: { core: { limit: 5000, remaining: 4321, reset: 9999 } },
      }),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.remaining).toBe(4321);
    expect(body.resetAt).toBe(9999);
  });

  it("returns warn when remaining budget is dangerously low", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json({
        resources: { core: { limit: 5000, remaining: 12, reset: 1 } },
      }),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.status).toBe("warn");
  });
});
