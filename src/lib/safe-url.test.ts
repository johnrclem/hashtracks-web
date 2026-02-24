import { describe, it, expect } from "vitest";
import { safeUrl } from "./safe-url";

describe("safeUrl", () => {
  it("returns null for empty/null/undefined", () => {
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl("")).toBeNull();
    expect(safeUrl("   ")).toBeNull();
  });

  it("allows https URLs", () => {
    expect(safeUrl("https://example.com")).toBe("https://example.com");
    expect(safeUrl("https://facebook.com/nych3")).toBe("https://facebook.com/nych3");
  });

  it("allows http URLs", () => {
    expect(safeUrl("http://example.com")).toBe("http://example.com");
  });

  it("trims whitespace", () => {
    expect(safeUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("rejects javascript: URLs", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("javascript:void(0)")).toBeNull();
  });

  it("rejects data: URLs", () => {
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(safeUrl("not-a-url")).toBeNull();
    expect(safeUrl("ftp://files.example.com")).toBeNull();
  });
});
