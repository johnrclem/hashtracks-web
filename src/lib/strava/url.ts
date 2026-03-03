/** Build the canonical Strava activity URL. */
export function buildStravaUrl(stravaActivityId: string): string {
  return `https://www.strava.com/activities/${stravaActivityId}`;
}

/** Validate and extract Strava activity ID from a URL. */
export function extractStravaActivityId(url: string): string | null {
  const match = url.match(/strava\.com\/activities\/(\d+)/i);
  return match ? match[1] : null;
}
