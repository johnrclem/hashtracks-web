"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";

/** User-facing error messages keyed by the `reason` query parameter from the OAuth callback. */
const ERROR_MESSAGES = {
  invalid_state: "Connection failed — please try again",
  athlete_linked: "This Strava account is already linked to another user",
  token_exchange: "Failed to connect to Strava — please try again",
  athlete_limit:
    "Strava connection limit reached — the app is pending Strava review. Please try again later.",
  no_code: "Connection failed — please try again",
} as const;

type StravaErrorReason = keyof typeof ERROR_MESSAGES;

/**
 * Reads `?strava=...&reason=...` query parameters and displays a toast
 * notification for Strava OAuth connection results, then cleans the
 * params from the URL so they don't persist on refresh.
 *
 * Renders no visible UI — side-effect-only component.
 */
export function StravaStatusToast() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

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
      const message =
        ERROR_MESSAGES[reason as StravaErrorReason] ??
        "Failed to connect to Strava";
      toast.error(message);
    }

    // Clean query params from URL
    const params = new URLSearchParams(searchParams.toString());
    params.delete("strava");
    params.delete("reason");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  return null;
}
