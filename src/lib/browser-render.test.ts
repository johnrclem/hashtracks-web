import { describe, it, expect } from "vitest";
import { formatRenderErrorBody } from "./browser-render";

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
