/**
 * DNS-aware SSRF validation (server-only).
 *
 * `validateSourceUrlWithDns` extends the synchronous `validateSourceUrl`
 * (in `./utils`) with a `dns.lookup` that re-validates every resolved
 * A/AAAA record against private ranges. This protects against DNS
 * rebinding and domains that resolve directly to private IPs.
 *
 * This module MUST NOT be imported from client components because it
 * pulls in `node:dns/promises`. Client-safe validation is available via
 * `validateSourceUrl` in `./utils`.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import {
  validateSourceUrl,
  isPrivateIPv4,
  resolveIPv4Mapped,
  checkIPv6Private,
} from "./utils";

/**
 * Return true if a DNS-resolved address is in a private/reserved range.
 * Handles both IPv4 and IPv4-mapped IPv6 answers plus IPv6 loopback /
 * unique-local / link-local ranges.
 */
function isDnsResolvedPrivate(address: string, family: number): boolean {
  const lower = address.toLowerCase();
  const candidate = family === 6 ? resolveIPv4Mapped(lower) : lower;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(candidate);
  if (v4) {
    const [, a, b, c, d] = v4.map(Number);
    return isPrivateIPv4(a, b, c, d);
  }
  if (family === 6) {
    try {
      checkIPv6Private(lower);
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Async variant of `validateSourceUrl` that additionally resolves the
 * hostname and re-validates every A/AAAA record. Prevents DNS rebinding
 * and domains that resolve to private IPs (e.g., rebind.network).
 *
 * If the hostname is already a literal IP, the sync check is sufficient
 * and no DNS lookup is performed. For non-IP hostnames, all resolved
 * addresses must be public or the function throws.
 */
export async function validateSourceUrlWithDns(url: string): Promise<void> {
  validateSourceUrl(url);

  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  // If it's already a literal IP (dotted-quad, IPv6, integer, or hex), the
  // sync check already covered it — no DNS lookup needed.
  if (
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(hostname) ||
    hostname.includes(":") ||
    /^(?:0x[\da-f]+|\d+)$/i.test(hostname)
  ) {
    return;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dnsLookup(hostname, { all: true });
  } catch {
    throw new Error("Blocked URL: DNS resolution failed");
  }

  for (const { address, family } of addresses) {
    if (isDnsResolvedPrivate(address, family)) {
      throw new Error("Blocked URL: DNS resolved to private/reserved IP");
    }
  }
}
