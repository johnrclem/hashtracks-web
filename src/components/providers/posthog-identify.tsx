"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import { identifyUser, resetIdentity } from "@/lib/analytics";

/**
 * Identifies the current Clerk user in PostHog when they log in,
 * and resets identity when they log out.
 */
export function PostHogIdentify() {
  const { isSignedIn, user } = useUser();

  useEffect(() => {
    if (isSignedIn && user?.id) {
      identifyUser(user.id);
      Sentry.setUser({ id: user.id });
    } else if (isSignedIn === false) {
      resetIdentity();
      Sentry.setUser(null);
    }
  }, [isSignedIn, user?.id]);

  return null;
}
