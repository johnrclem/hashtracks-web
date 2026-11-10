import { restoreEnv } from "@/test/env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/ops-digest", () => ({ buildOpsDigest: vi.fn() }));

import { buildOpsDigest } from "@/lib/admin/ops-digest";
import { GET } from "./route";

const TOKEN = "t".repeat(64);
const URL = "https://www.hashtracks.xyz/api/audit/agent/ops-digest";

function get(token: string | null): Request {
  const headers = new Headers();
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  return new Request(URL, { headers });
}

const original = process.env.AUDIT_AGENT_TOKEN;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUDIT_AGENT_TOKEN = TOKEN;
});
afterEach(() => restoreEnv("AUDIT_AGENT_TOKEN", original));

describe("GET /api/audit/agent/ops-digest", () => {
  it("rejects a request without the agent token and never queries", async () => {
    const res = await GET(get(null));
    expect(res.status).toBe(401);
    expect(buildOpsDigest).not.toHaveBeenCalled();
  });

  it("rejects a wrong token", async () => {
    const res = await GET(get("x".repeat(64)));
    expect(res.status).toBe(401);
    expect(buildOpsDigest).not.toHaveBeenCalled();
  });

  it("returns the digest for the agent", async () => {
    vi.mocked(buildOpsDigest).mockResolvedValue({ alertsCreated24h: 2 } as never);
    const res = await GET(get(TOKEN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { alertsCreated24h: 2 } });
  });
});
