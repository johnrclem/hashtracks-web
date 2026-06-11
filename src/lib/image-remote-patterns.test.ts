import { LOGO_REMOTE_PATTERNS, isOptimizableLogo } from "./image-remote-patterns";

describe("LOGO_REMOTE_PATTERNS (image optimizer allowlist)", () => {
  it("never allows a global wildcard host (SSRF / proxy-amplification guard)", () => {
    for (const pattern of LOGO_REMOTE_PATTERNS) {
      expect(pattern.hostname).not.toBe("**");
      expect(pattern.hostname).not.toBe("*");
      // Every entry must be a concrete domain (a dot-bearing host), so the
      // optimizer can only fetch from first-party origins.
      expect(pattern.hostname).toContain(".");
    }
  });

  it("only permits https origins", () => {
    for (const pattern of LOGO_REMOTE_PATTERNS) {
      expect(pattern.protocol).toBe("https");
    }
  });
});

describe("isOptimizableLogo (per-URL optimizer gate)", () => {
  it("optimizes site-relative first-party assets", () => {
    expect(isOptimizableLogo("/kennel-logos/qbk.png")).toBe(true);
  });

  it("optimizes Vercel Blob URLs (first-party upload destination)", () => {
    expect(isOptimizableLogo("https://abc123.public.blob.vercel-storage.com/logo.png")).toBe(true);
  });

  it("does NOT optimize arbitrary third-party https hosts (rendered unoptimized instead)", () => {
    expect(isOptimizableLogo("https://keywesthash.com/uploads/logo.jpg")).toBe(false);
    expect(isOptimizableLogo("https://haguehash.nl/wp-content/uploads/logo.png")).toBe(false);
  });

  it("rejects a lookalike host that merely contains the Blob domain as a substring", () => {
    expect(isOptimizableLogo("https://evil.public.blob.vercel-storage.com.attacker.test/x.png")).toBe(false);
  });

  it("rejects protocol-relative and non-https URLs", () => {
    expect(isOptimizableLogo("//cdn.example.com/logo.png")).toBe(false);
    expect(isOptimizableLogo("http://example.com/logo.png")).toBe(false);
  });

  it("rejects empty / unparseable values", () => {
    expect(isOptimizableLogo("")).toBe(false);
    expect(isOptimizableLogo("not a url")).toBe(false);
  });
});
