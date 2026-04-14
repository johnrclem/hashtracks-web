import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Wraps a kennel reference (Link, span, etc.) with a tooltip showing the
 * kennel's full name. Returns the child unchanged when fullName is empty —
 * both hareline's EventCard and travel cards display the shortName as the
 * primary content and reveal the fullName on hover, so callers don't have
 * to special-case the "no fullName" path.
 *
 * The child is passed through with `asChild` so radix Tooltip re-uses the
 * caller's element (Link / span / etc.) as the trigger, preserving any
 * href / title / className the caller set.
 */
export function KennelNameTooltip({
  fullName,
  children,
}: {
  fullName: string;
  children: ReactElement;
}) {
  if (!fullName) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{fullName}</TooltipContent>
    </Tooltip>
  );
}
