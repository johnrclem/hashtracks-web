import { safeUrl, safeImageSrc } from "./safe-url";

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

describe("safeImageSrc", () => {
  it("returns null for empty/null/undefined", () => {
    expect(safeImageSrc(null)).toBeNull();
    expect(safeImageSrc(undefined)).toBeNull();
    expect(safeImageSrc("")).toBeNull();
    expect(safeImageSrc("   ")).toBeNull();
  });

  it("allows self-hosted logo paths under /kennel-logos/", () => {
    expect(safeImageSrc("/kennel-logos/rih3.gif")).toBe("/kennel-logos/rih3.gif");
    expect(safeImageSrc("  /kennel-logos/mh3-de.png  ")).toBe("/kennel-logos/mh3-de.png");
    expect(safeImageSrc("/kennel-logos/ah3-nz.webp")).toBe("/kennel-logos/ah3-nz.webp");
  });

  it("allows http/https absolute URLs", () => {
    expect(safeImageSrc("https://example.com/logo.png")).toBe("https://example.com/logo.png");
    expect(safeImageSrc("http://example.com/logo.png")).toBe("http://example.com/logo.png");
  });

  it("rejects same-origin paths outside the logo namespace", () => {
    expect(safeImageSrc("/api/foo")).toBeNull();
    expect(safeImageSrc("/admin")).toBeNull();
    expect(safeImageSrc("/misman/x/settings")).toBeNull();
  });

  it("rejects traversal, nested dirs, and non-image relative paths", () => {
    expect(safeImageSrc("/kennel-logos/../api/secret.png")).toBeNull();
    expect(safeImageSrc("/kennel-logos/sub/dir.png")).toBeNull();
    expect(safeImageSrc("/kennel-logos/evil.txt")).toBeNull();
    expect(safeImageSrc("/kennel-logos/")).toBeNull();
  });

  it("rejects protocol-relative URLs (could point off-origin)", () => {
    expect(safeImageSrc("//evil.example/logo.png")).toBeNull();
  });

  it("rejects unsafe schemes and malformed values", () => {
    expect(safeImageSrc("javascript:alert(1)")).toBeNull();
    expect(safeImageSrc("data:image/png;base64,AAAA")).toBeNull();
    expect(safeImageSrc("not-a-url")).toBeNull();
  });
});
