import Link from "next/link";
import { RegionBadge } from "@/components/hareline/RegionBadge";
import { ActivityStatusBadge } from "@/components/kennels/ActivityStatusBadge";
import { KennelLogo } from "@/components/kennels/KennelLogo";
import { formatSchedule, formatDateShort, type ScheduleSlot } from "@/lib/format";

export interface KennelCardData {
  id: string;
  slug: string;
  shortName: string;
  fullName: string;
  region: string;
  stateGroup: string;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
  logoUrl?: string | null;
  description: string | null;
  foundedYear: number | null;
  scheduleDayOfWeek: string | null;
  scheduleTime: string | null;
  scheduleFrequency: string | null;
  scheduleRules?: ScheduleSlot[] | null;
  nextEvent: { date: string; title: string | null } | null;
  lastEventDate: string | null;
}

interface KennelCardProps {
  kennel: KennelCardData;
}

export function KennelCard({ kennel }: KennelCardProps) {
  const schedule = formatSchedule(kennel);
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  // Is next event within 7 days?
  const isNextSoon = kennel.nextEvent
    ? new Date(kennel.nextEvent.date).getTime() - now < 7 * 24 * 60 * 60 * 1000
    : false;

  return (
    <Link href={`/kennels/${kennel.slug}`}>
      <div className={`rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:shadow-sm h-full flex flex-col${!kennel.nextEvent ? " opacity-60" : ""}`}>
        {/* Header: logo + shortName + region badge. Logo avatar mirrors the
            profile-page hero (src/app/kennels/[slug]/page.tsx) at card scale;
            initials are the null-logo fallback. */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <KennelLogo
              logoUrl={kennel.logoUrl}
              alt={`${kennel.shortName} logo`}
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 rounded-lg object-contain bg-white dark:bg-background ring-1 ring-border"
              fallback={
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold text-muted-foreground"
                  aria-hidden="true"
                >
                  {kennel.shortName.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3).toUpperCase()}
                </div>
              }
            />
            <div className="min-w-0">
              <h3 className="text-base font-bold leading-tight truncate" title={kennel.fullName}>
                {kennel.shortName}
              </h3>
              <p className="text-sm text-muted-foreground truncate">
                {kennel.fullName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ActivityStatusBadge lastEventDate={kennel.lastEventDate} hasUpcomingEvent={!!kennel.nextEvent} />
            <RegionBadge region={kennel.region} size="sm" />
          </div>
        </div>

        {/* Schedule + founded */}
        {(schedule || kennel.foundedYear) && (
          <div className="mt-2 text-xs text-muted-foreground">
            {schedule && <span>{schedule}</span>}
            {schedule && kennel.foundedYear && <span> · </span>}
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
        <div className="mt-3 pt-2 border-t text-xs">
          {kennel.nextEvent ? (
            <>
              <span className="text-muted-foreground">Next run: </span>
              <span className={isNextSoon ? "font-semibold text-blue-600 dark:text-blue-400" : ""}>
                {formatDateShort(kennel.nextEvent.date)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground italic">No upcoming runs</span>
          )}
        </div>
      </div>
    </Link>
  );
}
