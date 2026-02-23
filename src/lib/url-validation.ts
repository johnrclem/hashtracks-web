/**
 * SSRF protection utilities for server-side URL validation.
 * Shared between preview-action.ts and suggest-source-config-action.ts.
 */

/** Validate URL for SSRF protection: only http/https, no private or loopback IPs. */
export function validateFetchUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL format";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only http and https URLs are allowed";
  }

  const hostname = parsed.hostname;

  // Block localhost and loopback
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0"
  ) {
    return "URLs pointing to localhost are not allowed";
  }

  // Block private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x link-local)
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) // link-local
    ) {
      return "URLs pointing to private IP addresses are not allowed";
    }
  }

  return null;
}
