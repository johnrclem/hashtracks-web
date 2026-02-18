import { formatSchedule, displayDomain } from "@/lib/format";
import {
  Calendar,
  Banknote,
  Globe,
  Landmark,
  Dog,
  Footprints,
} from "lucide-react";

interface QuickInfoCardProps {
  kennel: {
    scheduleDayOfWeek: string | null;
    scheduleTime: string | null;
    scheduleFrequency: string | null;
    scheduleNotes: string | null;
    hashCash: string | null;
    paymentLink: string | null;
    website: string | null;
    foundedYear: number | null;
    dogFriendly: boolean | null;
    walkersWelcome: boolean | null;
  };
}

export function QuickInfoCard({ kennel }: QuickInfoCardProps) {
  const schedule = formatSchedule(kennel);
  const hasAnyData =
    schedule ||
    kennel.hashCash ||
    kennel.website ||
    kennel.foundedYear ||
    kennel.dogFriendly === true ||
    kennel.walkersWelcome === true;

  if (!hasAnyData) return null;

  return (
    <div className="rounded-lg border p-4 space-y-2">
      {schedule && (
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{schedule}</span>
        </div>
      )}
      {kennel.scheduleNotes && (
        <p className="ml-6 text-xs text-muted-foreground">
          {kennel.scheduleNotes}
        </p>
      )}

      {kennel.hashCash && (
        <div className="flex items-center gap-2 text-sm">
          <Banknote className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{kennel.hashCash} hash cash</span>
          {kennel.paymentLink && (
            <a
              href={kennel.paymentLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Pay online &rarr;
            </a>
          )}
        </div>
      )}

      {kennel.website && (
        <div className="flex items-center gap-2 text-sm">
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
          <a
            href={kennel.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {displayDomain(kennel.website)}
          </a>
        </div>
      )}

      {kennel.foundedYear && (
        <div className="flex items-center gap-2 text-sm">
          <Landmark className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>Est. {kennel.foundedYear}</span>
        </div>
      )}

      {(kennel.dogFriendly === true || kennel.walkersWelcome === true) && (
        <div className="flex items-center gap-3 text-sm">
          {kennel.dogFriendly === true && (
            <span className="flex items-center gap-1">
              <Dog className="h-4 w-4 text-muted-foreground" />
              Dog friendly
            </span>
          )}
          {kennel.walkersWelcome === true && (
            <span className="flex items-center gap-1">
              <Footprints className="h-4 w-4 text-muted-foreground" />
              Walkers welcome
            </span>
          )}
        </div>
      )}
    </div>
  );
}
