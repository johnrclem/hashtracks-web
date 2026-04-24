"use client";

import { Lock } from "lucide-react";
import { capture } from "@/lib/analytics";
import { sanitizeRedirectPath } from "@/lib/travel/url";
import { AUTH_COPY } from "@/lib/travel/copy";
import { BoardingStamp } from "./BoardingStamp";
import type { LegState } from "./types";

/**
 * Ghost-leg variant rendered for anonymous users. Tapping navigates
 * to sign-in with a redirect back to the current form, so the user
 * returns to the same editing state post-auth. Multi-leg planning is
 * intentionally auth-only (drafts persist server-side via `saveDraftSearch`).
 */
export function SignInToAddLegRow({
  nextIndex,
  legs,
}: Readonly<{
  nextIndex: number;
  legs: LegState[];
}>) {
  // Preserve the in-progress leg-1 params so the user lands back on
  // /travel with the same destination after signing in. Multi-leg
  // continuation post-signin happens via the form — not via URL —
  // because the URL doesn't carry leg-N state pre-draft-save.
  const returnTo = (() => {
    if (legs.length === 0 || !legs[0].destination) return "/travel";
    const leg = legs[0];
    const p = new URLSearchParams({
      lat: String(leg.latitude),
      lng: String(leg.longitude),
      from: leg.startDate,
      to: leg.endDate,
      r: String(leg.radiusKm),
      q: leg.destination,
    });
    if (leg.timezone) p.set("tz", leg.timezone);
    return `/travel?${p.toString()}`;
  })();
  // SECURITY: only allow same-origin redirects. `sanitizeRedirectPath`
  // rejects absolute and protocol-relative URLs so an attacker-crafted
  // returnTo can't redirect past auth to an arbitrary host.
  const safeReturnTo = sanitizeRedirectPath(returnTo, "/travel");
  const signInHref = `/sign-in?redirect_url=${encodeURIComponent(safeReturnTo)}`;

  return (
    <a
      href={signInHref}
      onClick={() => capture("travel_auth_prompt_clicked", {})}
      className={`
        group flex w-full items-center gap-4 rounded-xl border-[1.5px]
        border-dashed border-muted-foreground/40 bg-card/40 p-5 text-left
        transition-all duration-200
        hover:border-muted-foreground/70 hover:bg-card
      `}
      aria-label={`${AUTH_COPY.signInToAddLeg} ${nextIndex}`}
    >
      <BoardingStamp label={`LEG ${String(nextIndex).padStart(2, "0")}`} variant="ghost" />
      <span className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.18em] text-muted-foreground/70 group-hover:text-foreground">
        <Lock className="h-3.5 w-3.5" />
        {AUTH_COPY.signInToAddLeg}
      </span>
      <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/50">
        {AUTH_COPY.multiCityIsFree}
      </span>
    </a>
  );
}
