/**
 * Shared kennel `logoUrl` validation rule (#1414).
 *
 * Both the server action (`createKennel`/`updateKennel`) and the admin form
 * enforce the same rule — empty or a site-relative `/path` is fine, otherwise
 * the value must parse as an `https` URL — but they surface different copy. The
 * rule itself (the security-relevant part) lives here once so the two can't
 * silently drift; each caller maps the returned code to its own message.
 */
export type LogoUrlCheck = "ok" | "unparseable" | "insecure-http" | "non-https";

export function checkLogoUrl(value: string): LogoUrlCheck {
  const trimmed = value.trim();
  // Empty or site-relative (incl. protocol-relative `//`, matching the existing
  // callers) is treated as valid here; emptiness is filtered upstream.
  if (!trimmed || trimmed.startsWith("/")) return "ok";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "unparseable";
  }
  if (parsed.protocol === "https:") return "ok";
  return parsed.protocol === "http:" ? "insecure-http" : "non-https";
}
