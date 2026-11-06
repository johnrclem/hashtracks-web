import { restoreEnv } from "@/test/env";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hasValidAgentToken, rejectUnlessAgent } from "./audit-agent-auth";

const TOKEN = "a".repeat(64);
const URL = "https://www.hashtracks.xyz/api/audit/agent/next-deep-dive";

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request(URL, { headers });
}

describe("hasValidAgentToken", () => {
  const original = process.env.AUDIT_AGENT_TOKEN;
  beforeEach(() => {
    process.env.AUDIT_AGENT_TOKEN = TOKEN;
  });
  afterEach(() => {
    restoreEnv("AUDIT_AGENT_TOKEN", original);
  });

  it.each([
    ["the exact bearer token", `Bearer ${TOKEN}`, true],
    ["the token with surrounding whitespace", `Bearer  ${TOKEN} `, true],
    ["a different token", `Bearer ${"b".repeat(64)}`, false],
    ["a prefix of the token", `Bearer ${TOKEN.slice(0, 40)}`, false],
    ["a non-Bearer scheme", `Basic ${TOKEN}`, false],
    ["an empty bearer", "Bearer ", false],
  ])("returns %s → %s", (_label, header, expected) => {
    expect(hasValidAgentToken(request(header as string))).toBe(expected);
  });

  it("rejects a request with no Authorization header", () => {
    expect(hasValidAgentToken(request())).toBe(false);
  });

  it("fails closed when the env var is unset", () => {
    delete process.env.AUDIT_AGENT_TOKEN;
    expect(hasValidAgentToken(request("Bearer "))).toBe(false);
    expect(hasValidAgentToken(request(`Bearer ${TOKEN}`))).toBe(false);
  });

  it("fails closed when the configured token is too short", () => {
    process.env.AUDIT_AGENT_TOKEN = "short-token";
    expect(hasValidAgentToken(request("Bearer short-token"))).toBe(false);
  });
});

describe("rejectUnlessAgent", () => {
  const original = process.env.AUDIT_AGENT_TOKEN;
  beforeEach(() => {
    process.env.AUDIT_AGENT_TOKEN = TOKEN;
  });
  afterEach(() => {
    restoreEnv("AUDIT_AGENT_TOKEN", original);
  });

  it("returns a 401 response without a valid token", async () => {
    const res = rejectUnlessAgent(request("Bearer nope"));
    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ data: null, error: "Unauthorized" });
  });

  it("returns null for a valid token", () => {
    expect(rejectUnlessAgent(request(`Bearer ${TOKEN}`))).toBeNull();
  });
});
