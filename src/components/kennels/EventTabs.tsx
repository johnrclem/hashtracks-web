"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CollapsibleEventList } from "@/components/kennels/CollapsibleEventList";
import type { HarelineEvent } from "@/components/hareline/EventCard";
import { Calendar, History } from "lucide-react";

interface EventTabsProps {
  upcoming: HarelineEvent[];
  past: HarelineEvent[];
}

export function EventTabs({ upcoming, past }: EventTabsProps) {
  const defaultTab = upcoming.length > 0 ? "upcoming" : "past";

  if (upcoming.length === 0 && past.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 px-6 py-10 text-center">
        <Calendar className="mx-auto h-8 w-8 text-muted-foreground/40" />
        <p className="mt-3 text-sm text-muted-foreground">
          No events yet. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList variant="line" className="w-full justify-start border-b border-border/40 pb-0">
        <TabsTrigger value="upcoming" className="gap-1.5">
          <Calendar className="h-3.5 w-3.5" />
          Upcoming
          {upcoming.length > 0 && (
            <span className="ml-0.5 rounded-full bg-foreground/[0.07] px-1.5 py-px text-[11px] font-medium tabular-nums">
              {upcoming.length}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="past" className="gap-1.5">
          <History className="h-3.5 w-3.5" />
          Past
          {past.length > 0 && (
            <span className="ml-0.5 rounded-full bg-foreground/[0.07] px-1.5 py-px text-[11px] font-medium tabular-nums">
              {past.length}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="upcoming" className="pt-4">
        {upcoming.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No upcoming events scheduled.
            </p>
          </div>
        ) : (
          <CollapsibleEventList
            events={upcoming}
            defaultLimit={4}
            label="upcoming"
          />
        )}
      </TabsContent>

      <TabsContent value="past" className="pt-4">
        {past.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No past events recorded.
            </p>
          </div>
        ) : (
          <CollapsibleEventList
            events={past}
            defaultLimit={10}
            label="past"
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
