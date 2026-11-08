/**
 * Host-anchored URL matching for the HTML_SCRAPER adapter registry.
 *
 * The registry used to route sources with bare substring regexes, and two of
 * them claimed another kennel's site: `/onh3\.wordpress\.com/` matched
 * `asuncionh3.wordpress.com`, and `/eh3\.org/` matched `boiseh3.org`. In both
 * cases the source ran the wrong kennel's adapter, and the only symptom was a
 * SOURCE_KENNEL_MISMATCH alert or zero events.
 *
 * `onHost()` parses the URL and compares whole hostname labels, so a route can
 * only claim its own host (and, optionally, a path under it). A longer host that
 * ends with the same letters, or the host's name appearing in some other URL's
 * path or query, never matches.
 */

/**
 * Which subdomains of a route's host also match it.
 * - `"any"` (default): the host itself and any subdomain (`www.`, `osh3.`, …).
 * - `"www"`: the host itself and `www.` only. Use it when a sibling kennel lives
 *   on another subdomain of the same domain (Taipei vs New Taipei).
 * - `"none"`: the exact host only.
 */
export type SubdomainPolicy = "any" | "www" | "none";

export interface HostRouteOptions {
  /**
   * Optional path prefix, compared case-insensitively on segment boundaries:
   * `"/slah3"` matches `/slah3` and `/slah3/runlist.html`, not `/slah3x`.
   * Must start with `/` and must not end with `/`.
   */
  path?: string;
  subdomains?: SubdomainPolicy;
}

export interface HostMatcher {
  readonly hosts: readonly string[];
  readonly path?: string;
  readonly subdomains: SubdomainPolicy;
  /** True when `url` is an http(s) URL on one of `hosts` (and under `path`, if set). */
  test(url: string): boolean;
}

const HOST_SHAPE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function hostnameMatches(hostname: string, host: string, subdomains: SubdomainPolicy): boolean {
  if (hostname === host) return true;
  if (subdomains === "www") return hostname === `www.${host}`;
  if (subdomains === "any") return hostname.endsWith(`.${host}`);
  return false;
}

function pathMatches(pathname: string, prefix: string): boolean {
  const lower = pathname.toLowerCase();
  return lower === prefix || lower.startsWith(`${prefix}/`);
}

/**
 * Build a route matcher for one host (or a few aliases of the same site).
 * Throws on a malformed host or path, so a bad registry entry fails at import
 * time (and in CI) instead of silently never matching.
 */
export function onHost(host: string | readonly string[], options: HostRouteOptions = {}): HostMatcher {
  const hosts = (typeof host === "string" ? [host] : [...host]).map((h) => h.toLowerCase());
  if (hosts.length === 0) throw new Error("onHost: at least one host is required");
  for (const h of hosts) {
    if (!HOST_SHAPE.test(h)) throw new Error(`onHost: "${h}" is not a bare hostname (no scheme, path or port)`);
  }

  const path = options.path?.toLowerCase();
  if (path !== undefined && (!path.startsWith("/") || path.endsWith("/"))) {
    throw new Error(`onHost: path "${options.path}" must start with "/" and must not end with "/"`);
  }
  const subdomains = options.subdomains ?? "any";

  return {
    hosts,
    path,
    subdomains,
    test(url: string): boolean {
      const parsed = parseHttpUrl(url);
      if (!parsed) return false;
      if (!hosts.some((h) => hostnameMatches(parsed.hostname, h, subdomains))) return false;
      return path === undefined || pathMatches(parsed.pathname, path);
    },
  };
}
