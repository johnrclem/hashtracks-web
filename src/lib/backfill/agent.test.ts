import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { backfillMode, checkPublicPageCount, rejectBackfillCall } from "./agent";

const TOKEN = "t".repeat(40);
const req = (auth?: string) => new Request("https://x/api/agent/backfill/plan", { headers: auth ? { authorization: auth } : {} });

describe("backfill agent auth and kill switch (G16, 7.1)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed without BACKFILL_AGENT_TOKEN, or with a short one, or the audit token", () => {
    vi.stubEnv("BACKFILL_AUTOMATION", "apply");
    vi.stubEnv("BACKFILL_AGENT_TOKEN", "");
    expect(rejectBackfillCall(req(`Bearer ${TOKEN}`), "read")?.status).toBe(401);
    vi.stubEnv("BACKFILL_AGENT_TOKEN", "short");
    expect(rejectBackfillCall(req("Bearer short"), "read")?.status).toBe(401);
    vi.stubEnv("BACKFILL_AGENT_TOKEN", TOKEN);
    vi.stubEnv("AUDIT_AGENT_TOKEN", "a".repeat(40));
    expect(rejectBackfillCall(req(`Bearer ${"a".repeat(40)}`), "read")?.status).toBe(401);
    expect(rejectBackfillCall(req(`Bearer ${TOKEN}`), "read")).toBeNull();
  });

  it.each([
    ["off", { read: 403, plan: 403, advance: 403 }],
    ["shadow", { read: null, plan: null, advance: 403 }],
    ["apply", { read: null, plan: null, advance: null }],
    ["garbage", { read: 403, plan: 403, advance: 403 }],
  ] as const)("BACKFILL_AUTOMATION=%s", (mode, expected) => {
    vi.stubEnv("BACKFILL_AGENT_TOKEN", TOKEN);
    vi.stubEnv("BACKFILL_AUTOMATION", mode);
    for (const needs of ["read", "plan", "advance"] as const) {
      expect(rejectBackfillCall(req(`Bearer ${TOKEN}`), needs)?.status ?? null).toBe(expected[needs]);
    }
  });

  it("defaults to off", () => {
    vi.stubEnv("BACKFILL_AUTOMATION", "");
    expect(backfillMode()).toBe("off");
  });
});

describe("V5: the public page's own count", () => {
  it("reads totalEvents from the page payload and compares", async () => {
    const page = (n: number) => vi.fn(async () => new Response(`...self.__next_f.push([1,"{\\"totalEvents\\":${n},\\"x\\":1}"])...`, { status: 200 }));
    expect(await checkPublicPageCount("zh4", 715, "https://h", page(715) as never)).toEqual({ ok: true, shown: 715 });
    expect(await checkPublicPageCount("zh4", 716, "https://h", page(715) as never)).toEqual({ ok: false, shown: 715 });
    const down = vi.fn(async () => new Response("", { status: 500 }));
    expect(await checkPublicPageCount("zh4", 1, "https://h", down as never)).toEqual({ ok: false, shown: null });
  });
});
