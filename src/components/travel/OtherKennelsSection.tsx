import Link from "next/link";
import { KennelStatusLine } from "@/components/kennels/KennelStatusLine";
import { TravelHintBadge } from "./TravelHintBadge";
import { otherKennelsBrowseLink, otherKennelsHeading } from "@/lib/travel/other-kennels";
import type { SerializedOtherKennel } from "@/lib/travel/serialize";

/**
 * Quiet or listing-only kennels inside the search radius, shown when a search
 * finds few runs, so a thin result still points somewhere real.
 */
export function OtherKennelsSection({
  place,
  kennels,
}: Readonly<{ place: string; kennels: SerializedOtherKennel[] }>) {
  if (kennels.length === 0) return null;
  const browse = otherKennelsBrowseLink(kennels);

  return (
    <section aria-labelledby="other-kennels-heading" className="mx-auto mt-10 max-w-3xl">
      <TravelHintBadge glyph="○" label="Kennels in your area" ariaLabel="Kennels in your area" />
      <div className="mb-4 flex items-baseline gap-3 border-b border-border pb-2">
        <h2 id="other-kennels-heading" className="font-display text-lg font-medium">
          {otherKennelsHeading(place)}
        </h2>
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {kennels.length} kennel{kennels.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {kennels.map((k) => (
          <li key={k.kennelId} className="py-3">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Link href={`/kennels/${k.slug}`} className="font-medium hover:underline">
                {k.shortName}
              </Link>
              <span className="text-sm text-muted-foreground">{k.fullName}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {Math.round(k.distanceKm)} km
              </span>
            </div>
            <KennelStatusLine
              evidence={k.evidence}
              ownPageUrl={k.ownPageUrl}
              kennelSlug={k.slug}
              surface="travel"
              showOwnPage
            />
          </li>
        ))}
      </ul>
      {browse && (
        <p className="mt-3 text-sm">
          <Link href={browse.href} className="underline underline-offset-2 hover:text-foreground">
            {browse.label} →
          </Link>
        </p>
      )}
    </section>
  );
}
