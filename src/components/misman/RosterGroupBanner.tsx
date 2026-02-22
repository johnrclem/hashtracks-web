import { Badge } from "@/components/ui/badge";
import { InfoPopover } from "@/components/ui/info-popover";
import { Users } from "lucide-react";

interface RosterGroupBannerProps {
  groupName: string;
  kennelNames: string[];
}

export function RosterGroupBanner({
  groupName,
  kennelNames,
}: RosterGroupBannerProps) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="flex items-start gap-2">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Shared Roster: {groupName}
            </span>
            <InfoPopover title="Shared Roster">
              These kennels share a single roster so hashers who run with
              multiple kennels only need one entry. Attendance is tracked
              per-kennel, but the roster is unified.
            </InfoPopover>
          </div>
          <div className="flex flex-wrap gap-1">
            {kennelNames.map((name) => (
              <Badge
                key={name}
                variant="secondary"
                className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
              >
                {name}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
