import { participationLevelAbbrev, participationLevelLabel } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface AttendanceBadgeProps {
  level: string;
  size?: "sm" | "md";
  onClick?: () => void;
}

export function AttendanceBadge({ level, size = "md", onClick }: AttendanceBadgeProps) {
  const abbrev = participationLevelAbbrev(level);
  const label = participationLevelLabel(level);

  const badge = (
    <Badge
      variant="default"
      className={`cursor-default bg-green-600 hover:bg-green-600 ${
        onClick ? "cursor-pointer hover:bg-green-700" : ""
      } ${size === "sm" ? "px-1 py-0 text-[10px]" : "px-1.5 py-0 text-xs"}`}
      onClick={onClick}
    >
      {abbrev}
    </Badge>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>{label}{onClick ? " (click to edit)" : ""}</TooltipContent>
    </Tooltip>
  );
}
