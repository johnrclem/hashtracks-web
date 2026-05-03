"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { capture } from "@/lib/analytics";
import { daysBetween } from "@/lib/travel/format";
import { consumeSaveIntent } from "@/lib/travel/save-intent";
import { saveTravelSearch } from "@/app/travel/actions";

interface TravelAutoSaveProps {
  destination: string;
  startDate: string;
  endDate: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  timezone?: string;
  /** Round-tripped from the URL `pid` param. Persisted on save so a
   *  later SSR lookup can match on placeId identity even when coords
   *  drift between autocomplete and geocode-fallback paths. */
  placeId?: string;
}

/**
 * Mounted on /travel when `?saved=1` is present AND the viewer is
 * authenticated. Fires once on mount with a three-layer guard:
 *
 * 1. Ref guard — defends against React Strict Mode's double-mount in dev.
 * 2. sessionStorage intent — TripSummary stashes `{ signature, timestamp }`
 *    when the guest clicks Save; we consume and verify here. A bare
 *    `?saved=1` without a matching intent is a no-op. This prevents
 *    crafted/shared URLs from triggering an account mutation on page load.
 * 3. Try/catch — a thrown server action doesn't leave unhandled promise
 *    rejection or ambiguous save state.
 *
 * In all cases (intent valid / invalid / save failed) the `saved=1` param
 * is stripped from the URL so refreshes don't re-fire.
 */
export function TravelAutoSave({
  destination,
  startDate,
  endDate,
  latitude,
  longitude,
  radiusKm,
  timezone,
  placeId,
}: TravelAutoSaveProps) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const stripSavedParam = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("saved");
      router.replace(url.pathname + url.search);
    };

    // Consume the intent first — on crafted URLs this short-circuits with
    // no server round-trip.
    const hasIntent = consumeSaveIntent({
      label: destination,
      latitude,
      longitude,
      radiusKm,
      startDate,
      endDate,
      timezone,
      placeId,
    });

    if (!hasIntent) {
      stripSavedParam();
      return;
    }

    (async () => {
      try {
        const result = await saveTravelSearch({
          label: destination,
          latitude,
          longitude,
          radiusKm,
          startDate,
          endDate,
          timezone,
          placeId,
        });
        if ("success" in result && result.success) {
          capture("travel_saved_search_created", {
            destination,
            dateRangeDays: daysBetween(startDate, endDate),
          });
          toast.success("Saved to your trips", {
            description: "View all your saved trips any time.",
          });
        } else {
          toast.error("Couldn't save this trip", {
            description:
              "error" in result ? result.error : "Please try again.",
          });
        }
      } catch (err) {
        console.error("[travel] auto-save threw", err);
        toast.error("Couldn't save this trip", {
          description: "Please try again.",
        });
      } finally {
        stripSavedParam();
      }
    })();
  }, [destination, startDate, endDate, latitude, longitude, radiusKm, timezone, placeId, router]);

  return null;
}
