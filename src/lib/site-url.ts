const DEFAULT_SITE_URL = "https://www.hashtracks.xyz";

export function getCanonicalSiteUrl(): string {
  const rawUrl = process.env.NEXT_PUBLIC_APP_URL || DEFAULT_SITE_URL;

  try {
    const url = new URL(rawUrl);

    if (url.hostname === "hashtracks.xyz") {
      url.hostname = "www.hashtracks.xyz";
    }

    return url.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}
