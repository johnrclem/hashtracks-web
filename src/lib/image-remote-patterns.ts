/**
 * Image-optimizer security boundary for kennel logos.
 *
 * Next's `/_next/image` optimizer is an UNAUTHENTICATED endpoint that fetches
 * whatever remote URL it's handed. A wildcard `remotePatterns` (`hostname:
 * "**"`) therefore turns the public deployment into an arbitrary-HTTPS
 * fetch/resize proxy — an SSRF-probing and bandwidth/CPU-amplification surface
 * (flagged by adversarial review on the #1301 logo change). So ONLY first-party
 * origins are allowed through the optimizer:
 *   - site-relative paths (`/kennel-logos/*`) — always first-party, need no
 *     `remotePatterns` entry.
 *   - Vercel Blob (`*.public.blob.vercel-storage.com`) — the #1414 upload
 *     destination, content-type/size-gated at ingestion.
 *
 * Third-party kennel logos (arbitrary WordPress origins, gohash.app, etc.) are
 * NOT proxied: `KennelLogo` renders them `unoptimized` (a direct browser→origin
 * fetch, exactly like a plain <img>), keeping lazy-loading + the onError
 * initials fallback without exposing the optimizer.
 */

export interface LogoRemotePattern {
  protocol: "https";
  hostname: string;
}

/** Hosts allowed through Next's image optimizer. First-party only. */
export const LOGO_REMOTE_PATTERNS: LogoRemotePattern[] = [
  { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
];

/**
 * Whether a logo URL may be optimized via `/_next/image`. True only for
 * first-party assets (site-relative paths and Vercel Blob); everything else
 * must render `unoptimized` so the public optimizer never proxies it.
 */
export function isOptimizableLogo(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Site-relative (but not protocol-relative `//host`) → first-party local asset.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname.endsWith(".public.blob.vercel-storage.com");
}
