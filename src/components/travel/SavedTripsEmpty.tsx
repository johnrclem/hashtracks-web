import Link from "next/link";
import { ArrowRight, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SavedTripsEmpty() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card">
        <Bookmark className="h-7 w-7 text-muted-foreground/40" aria-hidden="true" />
      </div>

      <div className="space-y-2">
        <h2 className="font-display text-2xl font-medium tracking-tight">
          No saved trips yet
        </h2>
        <p className="text-sm text-muted-foreground">
          Plan a trip, save it, and come back closer to travel for fresh
          results — confirmed events, likely runs, and possible activity will
          all be ready when you return.
        </p>
      </div>

      <Button asChild className="gap-2">
        <Link href="/travel">
          Plan a trip
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
