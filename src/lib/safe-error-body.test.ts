import { describe, it, expect } from "vitest";
import { safeErrorBody } from "./safe-error-body";

describe("safeErrorBody", () => {
  it("returns the full body when it's under the cap", async () => {
    const res = new Response("oops");
    expect(await safeErrorBody(res)).toBe("oops");
  });

  it("truncates with marker when the body exceeds the cap", async () => {
    const big = "x".repeat(2_000);
    const res = new Response(big);
    const out = await safeErrorBody(res, 100);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith("…(truncated)")).toBe(true);
  });

  it("returns <empty body> when the response has no readable stream", async () => {
    const res = new Response(null);
    expect(await safeErrorBody(res)).toBe("<empty body>");
  });
});
