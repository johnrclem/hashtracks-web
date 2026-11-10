"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import { identifyUser, resetIdentity } from "@/lib/analytics";

/** Admin role check, matching the Header's check on Clerk public metadata. */
export function isAdminUser(user: { publicMetadata?: unknown } | null | undefined): boolean {
  return (user?.publicMetadata as { role?: string } | undefined)?.role === "admin";
}

/**
 * Identifies the current Clerk user in PostHog and Sentry when they log in,
 * and resets identity when they log out. The pageview tracker also calls
 * `identifyUser` before its first pageview, so ordering between the two
 * effects doesn't matter (the call is idempotent).
 */
export function PostHogIdentify() {
  const { isSignedIn, user } = useUser();
  const isAdmin = isAdminUser(user);

  useEffect(() => {
    if (isSignedIn && user?.id) {
      identifyUser(user.id, { isAdmin });
      Sentry.setUser({ id: user.id });
    } else if (isSignedIn === false) {
      resetIdentity();
      Sentry.setUser(null);
    }
  }, [isSignedIn, user?.id, isAdmin]);

  return null;
}
