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
