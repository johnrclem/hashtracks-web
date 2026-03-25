"use client";

import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  context: "near_me" | "region" | "kennel" | "search" | "my_kennels" | "general";
  regionName?: string;
  kennelName?: string;
  query?: string;
  onClearFilters: () => void;
  onSwitchToAll?: () => void;
}

function getMessage(props: EmptyStateProps): string {
  switch (props.context) {
    case "near_me":
      return "No runs found near you yet.";
    case "region":
      return props.regionName
        ? `No upcoming runs in ${props.regionName}.`
        : "No upcoming runs in this region.";
    case "kennel":
      return props.kennelName
        ? `No upcoming events for ${props.kennelName}.`
        : "No upcoming events for this kennel.";
    case "search":
      return props.query
        ? `No events matching '${props.query}'.`
        : "No events matching your search.";
    case "my_kennels":
      return "No events from your subscribed kennels match these filters.";
    case "general":
    default:
      return "No events match these filters.";
  }
}

export function EmptyState(props: EmptyStateProps) {
  const { context, onClearFilters, onSwitchToAll } = props;
  const message = getMessage(props);

  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <SearchX className="h-10 w-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {context === "near_me" && (
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/suggest">Suggest a kennel</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              Browse all events
            </Button>
          </>
        )}

        {context === "region" && (
          <>
            <Button variant="outline" size="sm" onClick={onClearFilters}>
              Browse all events
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/suggest">Suggest a kennel</Link>
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
            <Button variant="outline" size="sm" onClick={onClearFilters}>
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
              <Button variant="outline" size="sm" onClick={onSwitchToAll}>
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
