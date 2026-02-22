/**
 * Group items by region, sorted alphabetically by region then shortName.
 */
export function groupByRegion<T extends { region: string; shortName: string }>(
  items: T[],
): { region: string; items: T[] }[] {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    if (!groups[item.region]) groups[item.region] = [];
    groups[item.region].push(item);
  }
  return Object.keys(groups)
    .sort()
    .map((region) => ({
      region,
      items: groups[region].sort((a, b) =>
        a.shortName.localeCompare(b.shortName),
      ),
    }));
}
