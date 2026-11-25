import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { browserRender, formatRenderErrorBody } from "./browser-render";

vi.mock("@/adapters/ssrf-dns", () => ({ validateSourceUrlWithDns: vi.fn().mockResolvedValue(undefined) }));

describe("formatRenderErrorBody", () => {
  it("formats {error, detail} as 'error: detail' (server 502 branch)", () => {
    const body = JSON.stringify({
      error: "Render failed",
      detail: "page.waitForSelector: Timeout 25000ms exceeded.",
    });
    expect(formatRenderErrorBody(body)).toBe(
      "Render failed: page.waitForSelector: Timeout 25000ms exceeded.",
    );
  });

  it("returns error alone when detail is missing (server 422 branch)", () => {
    const body = JSON.stringify({
      error: "No child frame matching \"comp-xxxx\" found (3 frames total)",
    });
    expect(formatRenderErrorBody(body)).toBe(
      "No child frame matching \"comp-xxxx\" found (3 frames total)",
    );
  });

  it("returns detail alone when error is missing", () => {
    const body = JSON.stringify({ detail: "something went wrong" });
    expect(formatRenderErrorBody(body)).toBe("something went wrong");
  });

  it("falls back to raw body when not JSON (Cloudflare 5xx page)", () => {
    const body = "<!DOCTYPE html><title>502 Bad Gateway</title>";
    expect(formatRenderErrorBody(body)).toBe(body);
  });

  it("falls back to raw body when error/detail are non-string", () => {
    const body = JSON.stringify({ error: { code: 1 }, detail: 42 });
    expect(formatRenderErrorBody(body)).toBe(body);
  });

  it("handles empty JSON object by returning the raw text", () => {
    const body = "{}";
    expect(formatRenderErrorBody(body)).toBe(body);
  });
});

describe("browserRender busy retries", () => {
  beforeEach(() => {
    vi.stubEnv("BROWSER_RENDER_URL", "https://render.example");
    vi.stubEnv("BROWSER_RENDER_KEY", "k");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("waits and retries twice on a busy 429, then returns the render", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(new Response("<html/>", { status: 200 }));
    const p = browserRender({ url: "https://example.com/" });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("<html/>");
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last busy retry", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("busy", { status: 429 }));
    const p = browserRender({ url: "https://example.com/" });
    const assertion = expect(p).rejects.toThrow("Browser render error (429)");
    await vi.runAllTimersAsync();
    await assertion;
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
