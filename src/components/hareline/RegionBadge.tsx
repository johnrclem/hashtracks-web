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
          className={`inline-flex items-center justify-center rounded-full font-semibold shrink-0 ${colors} ${
            size === "sm"
              ? "px-1.5 py-0 text-[10px] leading-4"
              : "px-2 py-0.5 text-xs"
          }`}
        >
          {abbrev}
        </span>
      </TooltipTrigger>
      <TooltipContent>{region}</TooltipContent>
    </Tooltip>
  );
}
