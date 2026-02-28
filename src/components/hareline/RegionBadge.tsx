import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { RegionData } from "@/lib/types/region";

interface RegionBadgeProps {
  regionData: RegionData;
  size?: "sm" | "md";
}

export function RegionBadge({ regionData, size = "md" }: RegionBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center justify-center rounded-full font-semibold shrink-0 ${regionData.colorClasses} ${
            size === "sm"
              ? "px-1.5 py-0 text-[10px] leading-4"
              : "px-2 py-0.5 text-xs"
          }`}
        >
          {regionData.abbrev}
        </span>
      </TooltipTrigger>
      <TooltipContent>{regionData.name}</TooltipContent>
    </Tooltip>
  );
}
