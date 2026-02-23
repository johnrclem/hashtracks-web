/**
 * URL variant helpers for hostname/protocol fallback probing.
 *
 * Keep this module dependency-light so adapters that only need URL manipulation
 * do not pull in HTML parsing dependencies.
 */

/**
 * Build canonical + fallback URL base variants for host/protocol edge-routing issues.
 * Order: original, host variant (www/non-www), protocol variant (http/https), protocol+host variant.
 */
export function buildUrlVariantCandidates(baseUrl: string): string[] {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const candidates = [normalizedBase];

  try {
    const parsed = new URL(normalizedBase);

    const hostVariant = new URL(parsed.toString());
    if (hostVariant.hostname.startsWith("www.")) {
      hostVariant.hostname = hostVariant.hostname.slice(4);
    } else {
      hostVariant.hostname = `www.${hostVariant.hostname}`;
    }
    candidates.push(hostVariant.toString().replace(/\/+$/, ""));

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const protocolVariant = new URL(parsed.toString());
      protocolVariant.protocol = parsed.protocol === "https:" ? "http:" : "https:";
      candidates.push(protocolVariant.toString().replace(/\/+$/, ""));

      const protocolAndHostVariant = new URL(protocolVariant.toString());
      if (protocolAndHostVariant.hostname.startsWith("www.")) {
        protocolAndHostVariant.hostname = protocolAndHostVariant.hostname.slice(4);
      } else {
        protocolAndHostVariant.hostname = `www.${protocolAndHostVariant.hostname}`;
      }
      candidates.push(protocolAndHostVariant.toString().replace(/\/+$/, ""));
    }
  } catch {
    // URL validation happens upstream.
  }

  return [...new Set(candidates)];
}
