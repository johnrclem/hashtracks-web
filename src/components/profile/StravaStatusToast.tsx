"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state: "Connection failed — please try again",
  athlete_linked: "This Strava account is already linked to another user",
  token_exchange: "Failed to connect to Strava — please try again",
  athlete_limit:
    "Strava connection limit reached — the app is pending Strava review. Please try again later.",
  no_code: "Connection failed — please try again",
};

export function StravaStatusToast() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const status = searchParams.get("strava");
    if (!status) return;

    if (status === "connected") {
      toast.success("Strava connected successfully");
    } else if (status === "denied") {
      toast.error("Strava authorization was cancelled");
    } else if (status === "already_connected") {
      toast.info("Strava is already connected");
    } else if (status === "error") {
      const reason = searchParams.get("reason") ?? "token_exchange";
      toast.error(ERROR_MESSAGES[reason] ?? "Failed to connect to Strava");
    }

    // Clean query params from URL
    const url = new URL(window.location.href);
    url.searchParams.delete("strava");
    url.searchParams.delete("reason");
    router.replace(url.pathname + url.search, { scroll: false });
  }, [searchParams, router]);

  return null;
}
