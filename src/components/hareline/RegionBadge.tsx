import { regionAbbrev, regionColorClasses } from "@/lib/format";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface RegionBadgeProps {
  region: string;
  size?: "sm" | "md";
}

export function RegionBadge({ region, size = "md" }: RegionBadgeProps) {
  const abbrev = regionAbbrev(region);
  const colors = regionColorClasses(region);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center justify-center rounded-full font-bold shrink-0 ${colors} ${
            size === "sm"
              ? "h-5 px-1.5 text-[10px] leading-5"
              : "px-2 py-0.5 text-xs"
          }`}
          aria-label={`Region: ${region}`}
          title={region}
          role="img"
        >
          {abbrev}
        </span>
      </TooltipTrigger>
      <TooltipContent>{region}</TooltipContent>
    </Tooltip>
  );
}
