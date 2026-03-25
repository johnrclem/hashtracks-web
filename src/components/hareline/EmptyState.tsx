"use client";

import { useEffect } from "react";
import Link from "next/link";
import { track } from "@vercel/analytics";
import { MapPinOff, SearchX, CalendarOff, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  context:
    | "near_me"
    | "region"
    | "kennel"
    | "search"
    | "my_kennels"
    | "general";
  regionName?: string;
  kennelName?: string;
  query?: string;
  onClearFilters: () => void;
  onSwitchToAll?: () => void;
}

function getConfig(props: EmptyStateProps) {
  switch (props.context) {
    case "near_me":
      return {
        icon: MapPinOff,
        message: "No runs found near you yet.",
        subtext:
          "We're expanding coverage all the time. Help us by suggesting your kennel!",
      };
    case "region":
      return {
        icon: Globe,
        message: props.regionName
          ? `No upcoming runs in ${props.regionName}.`
          : "No upcoming runs in this region.",
        subtext: "Try broadening your filters or check back later.",
      };
    case "kennel":
      return {
        icon: CalendarOff,
        message: props.kennelName
          ? `No upcoming events for ${props.kennelName}.`
          : "No upcoming events for this kennel.",
        subtext: "This kennel may be on a break or hasn't posted their next trail yet.",
      };
    case "search":
      return {
        icon: SearchX,
        message: props.query
          ? `No events matching '${props.query}'.`
          : "No events matching your search.",
        subtext: "Try a different search term or clear your filters.",
      };
    case "my_kennels":
      return {
        icon: CalendarOff,
        message:
          "No events from your subscribed kennels match these filters.",
        subtext: "Try adjusting your filters or viewing all kennels.",
      };
    case "general":
    default:
      return {
        icon: SearchX,
        message: "No events match these filters.",
        subtext: "Try adjusting or clearing your filters.",
      };
  }
}

export function EmptyState(props: EmptyStateProps) {
  const { context, onClearFilters, onSwitchToAll } = props;
  const { icon: Icon, message, subtext } = getConfig(props);

  useEffect(() => {
    track("empty_state_shown", { context });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center px-4">
      <div className="rounded-full bg-muted/50 p-4">
        <Icon className="h-8 w-8 text-muted-foreground/60" strokeWidth={1.5} />
      </div>

      <div className="space-y-1 max-w-sm">
        <p className="text-sm font-medium text-foreground">{message}</p>
        <p className="text-xs text-muted-foreground">{subtext}</p>
      </div>

      <div className="flex flex-wrap justify-center gap-2 mt-1">
        {(context === "near_me" || context === "region") && (
          <>
            <Button variant="default" size="sm" asChild>
              <Link href="/suggest">Suggest a kennel</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              Browse all events
            </Button>
          </>
        )}

        {context === "kennel" && (
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}

        {context === "search" && (
          <>
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              Clear search
            </Button>
            <Button variant="ghost" size="sm" onClick={onClearFilters}>
              Browse all events
            </Button>
          </>
        )}

        {context === "my_kennels" && (
          <>
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              Clear all filters
            </Button>
            {onSwitchToAll && (
              <Button variant="default" size="sm" onClick={onSwitchToAll}>
                Switch to All Kennels
              </Button>
            )}
          </>
        )}

        {context === "general" && (
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear all filters
          </Button>
        )}
      </div>
    </div>
  );
}
