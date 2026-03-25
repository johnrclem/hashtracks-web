"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Loader2, Search, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useGeolocation } from "@/hooks/useGeolocation";
import { setLocationPref } from "@/lib/location-pref";

interface FindRunsSectionProps {
  readonly regions: string[];
}

export function FindRunsSection({ regions }: FindRunsSectionProps) {
  const router = useRouter();
  const [geoState, requestLocation] = useGeolocation();
  const [regionOpen, setRegionOpen] = useState(false);
  const navigatedRef = useRef(false);

  function handleUseLocation() {
    requestLocation();
  }

  // Navigate when geolocation resolves
  useEffect(() => {
    if (geoState.status === "granted" && !navigatedRef.current) {
      navigatedRef.current = true;
      setLocationPref({ type: "nearMe", distance: 50 });
      router.push("/hareline?dist=50");
    }
  }, [geoState.status, router]);

  function handleSelectRegion(region: string) {
    setLocationPref({ type: "region", name: region });
    setRegionOpen(false);
    router.push(`/hareline?regions=${encodeURIComponent(region)}`);
  }

  const isLoading = geoState.status === "loading";
  const isDenied = geoState.status === "denied";

  return (
    <section className="px-4 py-8 sm:py-10">
      <div className="mx-auto max-w-xl text-center">
        <h2 className="text-lg font-bold tracking-tight sm:text-xl">
          <Search className="mr-2 inline-block h-5 w-5 text-muted-foreground" />
          Find runs near you
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use your location or pick a region to see nearby events.
        </p>

        <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          {/* Use my location */}
          <Button
            variant="outline"
            className="h-10 gap-2"
            onClick={handleUseLocation}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Getting location...
              </>
            ) : (
              <>
                <MapPin className="h-4 w-4" />
                Use my location
              </>
            )}
          </Button>

          <span className="text-xs text-muted-foreground">or</span>

          {/* Region picker */}
          <Popover open={regionOpen} onOpenChange={setRegionOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-10 gap-2">
                Pick a region
                <ChevronDown className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] p-0" align="center">
              <Command>
                <CommandInput placeholder="Search regions..." />
                <CommandList>
                  <CommandEmpty>No regions found.</CommandEmpty>
                  {regions.map((region) => (
                    <CommandItem
                      key={region}
                      value={region}
                      onSelect={() => handleSelectRegion(region)}
                    >
                      {region}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {isDenied && (
          <p className="mt-3 text-xs text-destructive">
            Location access denied. Try picking a region instead.
          </p>
        )}
      </div>
    </section>
  );
}
