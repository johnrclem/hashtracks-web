/**
 * Phase 1.5 sporty.co.nz WAF bypass spike.
 *
 * Probes three Wellington/Hamilton kennel pages (Capital H3, Mooloo HHH,
 * Geriatrix H3) with three fetch strategies, in order of escalation:
 *
 *   1. Plain `safeFetch`                          — baseline; expected to 403.
 *   2. `safeFetch(url, { useResidentialProxy })`  — NAS residential proxy.
 *   3. `browserRender({ url, waitFor: 'body' })`  — NAS Playwright service.
 *
 * For each (strategy, URL) pair we log HTTP status (or render outcome), body
 * length, and a 500-char excerpt so we can eyeball whether the response is
 * the real page or a WAF challenge. The first 2 strategies that succeed for
 * each kennel get their full HTML dumped to /tmp so we can inspect the
 * markup offline and identify the hareline table layout.
 *
 * Usage: npx tsx scripts/spike-sporty-co-nz.ts
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { safeFetch } from "@/adapters/safe-fetch";
import { browserRender } from "@/lib/browser-render";

const KENNELS = [
  { slug: "capitalh3",   shortName: "Capital H3" },
  { slug: "mooloohhh",   shortName: "Mooloo HHH" },
  { slug: "geriatrixhhh", shortName: "Geriatrix H3" },
] as const;

type Outcome = {
  approach: string;
  ok: boolean;
  status?: number | string;
  bodyLen: number;
  excerpt: string;
  error?: string;
  fixturePath?: string;
};

/** Quick sniff: is this real-looking HTML (a page that has actual content) or
 *  a WAF/challenge wall? Returns true only when the body has both a `<head>`
 *  and references to the kennel slug, which any genuine sporty.co.nz hareline
 *  page should. */
function looksLikeRealPage(body: string, slug: string): boolean {
  if (body.length < 1000) return false;
  const lower = body.toLowerCase();
  if (lower.includes("cloudflare") && lower.includes("ray id")) return false;
  if (lower.includes("attention required") || lower.includes("just a moment")) return false;
  return lower.includes("<head") && lower.includes(slug.toLowerCase());
}

async function tryPlain(url: string, slug: string): Promise<Outcome> {
  try {
    const res = await safeFetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Spike)" },
    });
    const body = await res.text();
    return {
      approach: "plain safeFetch",
      ok: res.ok && looksLikeRealPage(body, slug),
      status: res.status,
      bodyLen: body.length,
      excerpt: body.slice(0, 500),
    };
  } catch (err) {
    return { approach: "plain safeFetch", ok: false, status: "throw", bodyLen: 0, excerpt: "", error: String(err) };
  }
}

async function tryProxy(url: string, slug: string): Promise<Outcome> {
  try {
    const res = await safeFetch(url, {
      useResidentialProxy: true,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Spike)" },
    });
    const body = await res.text();
    const ok = res.ok && looksLikeRealPage(body, slug);
    const out: Outcome = {
      approach: "residential proxy",
      ok,
      status: res.status,
      bodyLen: body.length,
      excerpt: body.slice(0, 500),
    };
    if (ok) {
      const path = `/tmp/sporty-${slug}-proxy.html`;
      writeFileSync(path, body);
      out.fixturePath = path;
    }
    return out;
  } catch (err) {
    return { approach: "residential proxy", ok: false, status: "throw", bodyLen: 0, excerpt: "", error: String(err) };
  }
}

async function tryBrowserRender(
  url: string,
  slug: string,
  variant: { label: string; waitFor: string; timeout: number },
): Promise<Outcome> {
  const approach = `browserRender (waitFor='${variant.waitFor}', ${variant.timeout}ms)`;
  try {
    const html = await browserRender({
      url,
      waitFor: variant.waitFor,
      timeout: variant.timeout,
    });
    const ok = looksLikeRealPage(html, slug);
    const out: Outcome = {
      approach,
      ok,
      status: "render-ok",
      bodyLen: html.length,
      excerpt: html.slice(0, 500),
    };
    if (ok) {
      const path = `/tmp/sporty-${slug}-${variant.label}.html`;
      writeFileSync(path, html);
      out.fixturePath = path;
    }
    return out;
  } catch (err) {
    return { approach, ok: false, status: "throw", bodyLen: 0, excerpt: "", error: String(err) };
  }
}

function printOutcome(o: Outcome): void {
  const mark = o.ok ? "✓" : "✗";
  console.log(`    ${mark} ${o.approach}: status=${o.status} bytes=${o.bodyLen}`);
  if (o.error) console.log(`        error: ${o.error.slice(0, 200)}`);
  if (o.excerpt) {
    const oneLine = o.excerpt.replace(/\s+/g, " ").trim().slice(0, 240);
    console.log(`        excerpt: ${oneLine}`);
  }
  if (o.fixturePath) console.log(`        → wrote ${o.fixturePath}`);
}

/** browserRender variants, ordered by likelihood of bypassing Cloudflare's
 *  "Just a moment..." challenge. The default `waitFor: "body"` matches the
 *  challenge page itself (it has a body) and returns before the challenge
 *  resolves, so we try selectors that ONLY exist on the real sporty.co.nz
 *  shell (nav, footer) and give Playwright extra time to clear the JS
 *  puzzle (~5-10s typical + safety margin). */
const RENDER_VARIANTS = [
  { label: "footer-30s",    waitFor: "footer",                                                    timeout: 30_000 },
  { label: "spnav-30s",     waitFor: "nav, [class*='nav'], [class*='menu']",                     timeout: 30_000 },
  { label: "sportylogo-30s", waitFor: "a[href*='sporty.co.nz'], img[alt*='Sporty' i], #footer", timeout: 30_000 },
] as const;

async function main(): Promise<void> {
  console.log("=== sporty.co.nz WAF bypass spike ===\n");
  for (const k of KENNELS) {
    const url = `https://www.sporty.co.nz/${k.slug}`;
    console.log(`\n── ${k.shortName} (${url}) ──`);
    const plain = await tryPlain(url, k.slug);
    printOutcome(plain);
    if (plain.ok) {
      console.log("    (plain fetch worked — no bypass needed)");
      continue;
    }
    const proxy = await tryProxy(url, k.slug);
    printOutcome(proxy);
    // Try each browserRender variant; stop at the first one that returns
    // a real page so we don't burn 90s on a known-blocked host.
    for (const v of RENDER_VARIANTS) {
      const render = await tryBrowserRender(url, k.slug, v);
      printOutcome(render);
      if (render.ok) break;
    }
  }
  console.log("\n=== done ===");
}

main().catch((err) => {
  console.error("Spike failed:", err);
  process.exit(1);
});
