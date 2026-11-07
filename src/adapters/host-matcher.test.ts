import { describe, it, expect } from "vitest";
import { onHost } from "./host-matcher";

describe("onHost", () => {
  it("matches the host itself and any subdomain by default", () => {
    const m = onHost("eh3.org");
    expect(m.test("https://eh3.org")).toBe(true);
    expect(m.test("https://www.eh3.org/wp-json/wp/v2/pages/437")).toBe(true);
    expect(m.test("http://osh3.eh3.org/")).toBe(true);
  });

  it("never matches a longer host that merely ends with the same letters (Boise, Asunción)", () => {
    expect(onHost("eh3.org").test("https://www.boiseh3.org")).toBe(false);
    expect(onHost("onh3.wordpress.com").test("https://asuncionh3.wordpress.com/")).toBe(false);
    expect(onHost("swh3.wordpress.com").test("https://oswh3.wordpress.com/")).toBe(false);
    expect(onHost("ah3.nl").test("https://yah3.nl/")).toBe(false);
  });

  it("never matches the host's name inside another URL's path, query or fragment", () => {
    const m = onHost("ah3.nl");
    expect(m.test("https://www.facebook.com/groups/ah3.nl")).toBe(false);
    expect(m.test("https://r.jina.ai/https://ah3.nl/nextrun/")).toBe(false);
    expect(m.test("https://example.com/?site=ah3.nl")).toBe(false);
    expect(m.test("https://example.com/#ah3.nl")).toBe(false);
  });

  it("never matches a host that only starts with the route's host", () => {
    expect(onHost("och3.org").test("http://www.och3.org.uk/")).toBe(false);
    expect(onHost("eh3.org").test("https://eh3.org.evil.example/")).toBe(false);
  });

  it("ignores case and ports", () => {
    const m = onHost("hashphilly.com");
    expect(m.test("HTTPS://HashPhilly.COM/nexthash/")).toBe(true);
    expect(m.test("https://hashphilly.com:8443/nexthash/")).toBe(true);
  });

  it("rejects non-http schemes and strings that are not absolute URLs", () => {
    const m = onHost("hashphilly.com");
    expect(m.test("ftp://hashphilly.com/")).toBe(false);
    expect(m.test("hashphilly.com/nexthash/")).toBe(false);
    expect(m.test("")).toBe(false);
  });

  it("www policy matches only the apex and www (Taipei vs New Taipei)", () => {
    const m = onHost("taipeihash.com.tw", { subdomains: "www" });
    expect(m.test("https://taipeihash.com.tw/run_site.php")).toBe(true);
    expect(m.test("https://www.taipeihash.com.tw/run_site.php")).toBe(true);
    expect(m.test("https://nth3.taipeihash.com.tw/")).toBe(false);
  });

  it("none policy matches the exact host only", () => {
    const m = onHost("nth3.taipeihash.com.tw", { subdomains: "none" });
    expect(m.test("https://nth3.taipeihash.com.tw/")).toBe(true);
    expect(m.test("https://www.nth3.taipeihash.com.tw/")).toBe(false);
  });

  it("matches a path prefix on segment boundaries, case-insensitively", () => {
    const m = onHost("londonhash.org", { path: "/slah3" });
    expect(m.test("https://www.londonhash.org/slah3")).toBe(true);
    expect(m.test("https://www.londonhash.org/slah3/runlist/slash3list.html")).toBe(true);
    expect(m.test("https://www.londonhash.org/SLAH3/runlist/")).toBe(true);
    expect(m.test("https://www.londonhash.org/slah3x/")).toBe(false);
    expect(m.test("https://www.londonhash.org/runlist.php")).toBe(false);
    expect(m.test("https://www.londonhash.org/runlist.php?next=/slah3")).toBe(false);
  });

  it("checks the path against the pathname only, not the fragment", () => {
    const m = onHost("makesweat.com", { path: "/cityhash" });
    expect(m.test("https://makesweat.com/cityhash#hashes")).toBe(true);
    expect(m.test("https://makesweat.com/other#/cityhash")).toBe(false);
  });

  it("accepts several hosts for one site", () => {
    const m = onHost(["n2th3.org", "n2th3.wordpress.com"]);
    expect(m.test("https://n2th3.org")).toBe(true);
    expect(m.test("https://n2th3.wordpress.com/")).toBe(true);
    expect(m.test("https://xn2th3.org")).toBe(false);
  });

  it("throws on a malformed host or path so a bad registry entry fails fast", () => {
    expect(() => onHost("https://eh3.org")).toThrow();
    expect(() => onHost("eh3.org/path")).toThrow();
    expect(() => onHost("localhost")).toThrow();
    expect(() => onHost([])).toThrow();
    expect(() => onHost("eh3.org", { path: "slah3" })).toThrow();
    expect(() => onHost("eh3.org", { path: "/slah3/" })).toThrow();
  });

  it("exposes its hosts, path and subdomain policy for inspection", () => {
    const m = onHost("Sporty.co.nz", { path: "/CapitalH3" });
    expect(m.hosts).toEqual(["sporty.co.nz"]);
    expect(m.path).toBe("/capitalh3");
    expect(m.subdomains).toBe("any");
  });
});
