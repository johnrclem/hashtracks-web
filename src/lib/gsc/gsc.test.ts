import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createGsc, readServiceAccountKey, signAssertion, type Gsc } from "./client";
import { inspectHubCoverage, isHubUrl, readSitemapUrls, weeklySlice } from "./coverage";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const key = { client_email: "scorecard@proj.iam.gserviceaccount.com", private_key: pem };

describe("service-account key", () => {
  it("is null when unset and rejects a malformed value", () => {
    expect(readServiceAccountKey(undefined)).toBeNull();
    expect(() => readServiceAccountKey("{not json")).toThrow(/not valid JSON/);
    expect(() => readServiceAccountKey("{}")).toThrow(/lacks client_email/);
  });

  it("accepts a PEM stored with literal \\n escapes", () => {
    const raw = JSON.stringify({ ...key, private_key: pem.replace(/\n/g, "\\n") });
    expect(readServiceAccountKey(raw)?.private_key).toBe(pem);
  });

  it("signs an RS256 assertion for the read-only Search Console scope", () => {
    const jwt = signAssertion(key, 1_000);
    const [h, c, sig] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toMatchObject({ iss: key.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", exp: 4_600 });
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });
});

describe("client", () => {
  it("exchanges a token once and parses sitemaps and inspections", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("oauth2")) return Response.json({ access_token: "at", expires_in: 3600 });
      if (u.endsWith("/sitemaps"))
        return Response.json({ sitemap: [{ path: "https://www.hashtracks.xyz/sitemap.xml", lastDownloaded: "2026-11-28T00:00:00Z", errors: "0", warnings: "2", contents: [{ submitted: "829" }] }] });
      return Response.json({ inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed" } } });
    }) as unknown as typeof fetch;
    const gsc = createGsc(key, fetchImpl);
    const [sitemap] = await gsc.listSitemaps();
    expect(sitemap).toMatchObject({ errors: 0, warnings: 2, submitted: 829, isPending: false });
    expect(await gsc.inspect("https://www.hashtracks.xyz/kennels/nych3")).toEqual({
      url: "https://www.hashtracks.xyz/kennels/nych3", verdict: "PASS", coverageState: "Submitted and indexed",
    });
    expect(vi.mocked(fetchImpl).mock.calls.filter(([u]) => String(u).includes("oauth2"))).toHaveLength(1);
  });
});

describe("hub coverage", () => {
  it("counts kennel and region pages, not the directory or events", () => {
    expect(isHubUrl("https://www.hashtracks.xyz/kennels/nych3")).toBe(true);
    expect(isHubUrl("https://www.hashtracks.xyz/kennels/region/new-york-city-ny")).toBe(true);
    expect(isHubUrl("https://www.hashtracks.xyz/kennels")).toBe(false);
    expect(isHubUrl("https://www.hashtracks.xyz/kennels/region")).toBe(false);
    expect(isHubUrl("https://www.hashtracks.xyz/hareline/abc")).toBe(false);
  });

  it("walks consecutive slices only when the list exceeds one week's quota", () => {
    expect(weeklySlice(829, 5)).toBeNull();
    expect(weeklySlice(1000, 0)).toEqual({ start: 0, end: 900 });
    expect(weeklySlice(1000, 1)).toEqual({ start: 900, end: 1000 });
  });

  it("follows a sitemap index and inspects each hub once", async () => {
    const xml = (tag: string, locs: string[]) => `<${tag}>${locs.map((l) => `<x><loc>${l}</loc></x>`).join("")}</${tag}>`;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/sitemap.xml")) return new Response(xml("sitemapindex", ["https://www.hashtracks.xyz/sitemap/kennels.xml"]));
      return new Response(
        xml("urlset", [
          "https://www.hashtracks.xyz/kennels/nych3",
          "https://www.hashtracks.xyz/kennels/region/nyc",
          "https://www.hashtracks.xyz/kennels/nych3",
          "https://www.hashtracks.xyz/hareline/e1",
        ]),
      );
    }) as unknown as typeof fetch;
    expect(await readSitemapUrls(undefined, fetchImpl)).toHaveLength(4);

    const gsc = {
      inspect: vi.fn(async (url: string) =>
        url.endsWith("nych3")
          ? { url, verdict: "PASS", coverageState: "Submitted and indexed" }
          : { url, verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed" },
      ),
    } as unknown as Gsc;
    const coverage = await inspectHubCoverage(gsc, new Date(), { fetchImpl, sleep: async () => {} });
    expect(coverage).toMatchObject({ hubUrls: 2, inspected: 2, indexed: 1, failed: 0, slice: null });
    expect(coverage.byState).toEqual({ "Submitted and indexed": 1, "Crawled - currently not indexed": 1 });
  });
});
