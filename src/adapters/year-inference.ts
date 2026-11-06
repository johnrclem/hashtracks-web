/**
 * Year inference for year-less blog date lines ("Monday 20th July",
 * "Sunday, 7th of June").
 *
 * Picks the year (publishYear − 1, publishYear, or publishYear + 1) that places
 * the run date closest to the post's publish date. More robust than "use
 * publishYear, add a year if the date is before publish": it handles both the
 * Dec→Jan announcement rollover AND recap posts published days-to-weeks after
 * the run.
 *
 * Candidates that `Date.UTC` silently rolled over ("31st of February", "29th of
 * February" in a non-leap year) are skipped so a valid sibling year can still
 * win instead of being masked by a rolled date that happens to sit closer.
 *
 * @param day 1-31
 * @param month 1-12
 * @param publishedIso ISO 8601 publish timestamp of the post
 * @returns "YYYY-MM-DD", or null when no candidate year yields a real date
 */
export function inferYearClosestToPublish(
  day: number,
  month: number,
  publishedIso: string,
): string | null {
  const published = new Date(publishedIso);
  if (Number.isNaN(published.getTime())) return null;

  const pubYear = published.getUTCFullYear();
  const pubMs = published.getTime();

  let bestUtc: number | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const year of [pubYear - 1, pubYear, pubYear + 1]) {
    const candidate = Date.UTC(year, month - 1, day, 12, 0, 0);
    const resolved = new Date(candidate);
    if (resolved.getUTCDate() !== day || resolved.getUTCMonth() !== month - 1) continue;
    const diff = Math.abs(candidate - pubMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestUtc = candidate;
    }
  }
  if (bestUtc === null) return null;
  return new Date(bestUtc).toISOString().slice(0, 10);
}
