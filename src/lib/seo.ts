const CONTEXT = "https://schema.org";

// ── JSON-LD Builders ──

interface KennelJsonLdInput {
  fullName: string;
  shortName: string;
  slug: string;
  region: string;
  foundedYear: number | null;
  description: string | null;
  website: string | null;
}

export function buildKennelJsonLd(kennel: KennelJsonLdInput, baseUrl: string) {
  return {
    "@context": CONTEXT,
    "@type": "SportsTeam" as const,
    name: kennel.fullName,
    alternateName: kennel.shortName,
    url: `${baseUrl}/kennels/${kennel.slug}`,
    sport: "Hash House Harriers",
    location: {
      "@type": "City" as const,
      name: kennel.region,
    },
    ...(kennel.foundedYear ? { foundingDate: String(kennel.foundedYear) } : {}),
    ...(kennel.description ? { description: kennel.description } : {}),
    ...(kennel.website ? { sameAs: kennel.website } : {}),
  };
}

export function buildRegionItemListJsonLd(
  regionName: string,
  kennels: { slug: string }[],
  baseUrl: string,
) {
  return {
    "@context": CONTEXT,
    "@type": "ItemList" as const,
    name: `Hash House Harrier Kennels in ${regionName}`,
    numberOfItems: kennels.length,
    itemListElement: kennels.map((k, i) => ({
      "@type": "ListItem" as const,
      position: i + 1,
      url: `${baseUrl}/kennels/${k.slug}`,
    })),
  };
}

export function buildWebSiteJsonLd(baseUrl: string) {
  return {
    "@context": CONTEXT,
    "@type": "WebSite" as const,
    name: "HashTracks",
    url: baseUrl,
    description: "Discover hash house harrier runs, track attendance, and find kennels worldwide.",
    potentialAction: {
      "@type": "SearchAction" as const,
      target: `${baseUrl}/kennels?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

// ── Region Intro Generator ──

export function generateRegionIntro(
  regionName: string,
  activeKennelCount: number,
  scheduleDays: string[],
): string {
  const uniqueDays = [...new Set(scheduleDays)];
  const daysSummary = formatDaysSummary(uniqueDays);

  const kennelWord = activeKennelCount === 1 ? "kennel" : "kennels";

  if (daysSummary) {
    return `${regionName} has ${activeKennelCount} active ${kennelWord} with runs on ${daysSummary}. Find your next trail below.`;
  }
  return `${regionName} has ${activeKennelCount} active ${kennelWord}. Find your next trail below.`;
}

function formatDaysSummary(days: string[]): string {
  if (days.length === 0) return "";
  if (days.length >= 7) return "every day of the week";

  const pluralized = days.map((d) => d + "s");
  if (pluralized.length === 1) return pluralized[0];
  if (pluralized.length === 2) return `${pluralized[0]} and ${pluralized[1]}`;
  return `${pluralized.slice(0, -1).join(", ")}, and ${pluralized[pluralized.length - 1]}`;
}
