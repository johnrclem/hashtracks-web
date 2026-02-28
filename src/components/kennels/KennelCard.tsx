import Link from "next/link";
import { RegionBadge } from "@/components/hareline/RegionBadge";
import { formatSchedule, formatDateShort } from "@/lib/format";
import type { RegionData } from "@/lib/types/region";

export interface KennelCardData {
  id: string;
  slug: string;
  shortName: string;
  fullName: string;
  country: string;
  regionData: RegionData;
  description: string | null;
  foundedYear: number | null;
  scheduleDayOfWeek: string | null;
  scheduleTime: string | null;
  scheduleFrequency: string | null;
  nextEvent: { date: string; title: string | null } | null;
}

interface KennelCardProps {
  kennel: KennelCardData;
}

export function KennelCard({ kennel }: KennelCardProps) {
  const schedule = formatSchedule(kennel);

  // Is next event within 7 days?
  const isNextSoon = kennel.nextEvent
    ? new Date(kennel.nextEvent.date).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000
    : false;

  return (
    <Link href={`/kennels/${kennel.slug}`}>
      <div className="rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 h-full flex flex-col">
        {/* Header: shortName + region badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-bold leading-tight truncate">
              {kennel.shortName}
            </h3>
            <p className="text-sm text-muted-foreground truncate">
              {kennel.fullName}
            </p>
          </div>
          <RegionBadge regionData={kennel.regionData} size="sm" />
        </div>

        {/* Schedule + founded */}
        {(schedule || kennel.foundedYear) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {schedule && <span>{schedule}</span>}
            {kennel.foundedYear && <span>Est. {kennel.foundedYear}</span>}
          </div>
        )}

        {/* Description */}
        {kennel.description && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
            {kennel.description}
          </p>
        )}

        {/* Spacer to push next run to bottom */}
        <div className="flex-1" />

        {/* Next run */}
        {kennel.nextEvent && (
          <div className="mt-3 pt-2 border-t text-xs">
            <span className="text-muted-foreground">Next run: </span>
            <span className={isNextSoon ? "font-semibold text-blue-600" : ""}>
              {formatDateShort(kennel.nextEvent.date)}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}
