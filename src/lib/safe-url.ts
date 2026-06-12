/** Validate that a URL uses http or https protocol. Returns the trimmed URL or null. */
export function safeUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return trimmed;
  } catch {
    // Malformed URL
  }
  return null;
}

const LOGO_PREFIX = "/kennel-logos/";
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];

/**
 * Validate an image `src`: an http/https absolute URL, OR a same-origin relative
 * path inside the self-hosted logo namespace ("/kennel-logos/<file>.<img-ext>").
 * Self-hosted logos are stored as relative paths (see public/kennel-logos/),
 * which `safeUrl` rejects — using it for `logoUrl` would silently clear those
 * logos on any settings save. The relative branch is restricted to a single
 * filename under /kennel-logos/ so arbitrary same-origin routes ("/api/...",
 * "/admin"), path traversal ("../"), nested dirs, and protocol-relative
 * ("//evil.example") values cannot reach a public <img src>. Returns the
 * trimmed value or null.
 */
export function safeImageSrc(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) {
    if (!trimmed.startsWith(LOGO_PREFIX) || trimmed.includes("..")) return null;
    const name = trimmed.slice(LOGO_PREFIX.length);
    const isImage = IMAGE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
    if (name.length > 0 && !name.includes("/") && isImage) return trimmed;
    return null;
  }
  return safeUrl(trimmed);
}
