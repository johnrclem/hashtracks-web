"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";
import { useUser } from "@clerk/nextjs";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, Suspense, type ReactNode } from "react";
import { identifyUser } from "@/lib/analytics";
import { getVisitContext } from "@/lib/visit-recency";
import { isAdminUser } from "./posthog-identify";

if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_POSTHOG_KEY &&
  !posthog.__loaded
) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    persistence: "memory",
    disable_session_recording: true,
    ip: false,
    // `respect_dnt` is intentionally omitted to unblock event capture from browsers with Do Not Track enabled.
    // Our other privacy-first settings (e.g., memory persistence, no session recording) are deemed sufficient.
    capture_pageview: false, // manual via PostHogPageView
    capture_pageleave: true,
  });
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();
  const { isLoaded, isSignedIn, user } = useUser();
  const isAdmin = isAdminUser(user);
  const lastRef = useRef<string>("");
  const sentFirstRef = useRef(false);

  useEffect(() => {
    // Wait for Clerk so a signed-in visitor's pageview is attributed to them
    // (and admins are tagged as internal) instead of a throwaway anonymous ID.
    if (!pathname || !ph || !isLoaded) return;
    const url = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;
    if (url === lastRef.current) return;
    lastRef.current = url;

    if (isSignedIn && user?.id) identifyUser(user.id, { isAdmin });

    const visit = getVisitContext();
    const properties: Record<string, unknown> = { $current_url: url };
    if (!sentFirstRef.current) {
      sentFirstRef.current = true;
      // Super property: every event on this page load carries new-vs-returning.
      ph.register({ visit_recency: visit.recency });
      // Only the first pageview of a page load can be the visitor's first of the day.
      if (visit.firstVisitToday !== undefined) properties.first_visit_today = visit.firstVisitToday;
    } else {
      properties.first_visit_today = false;
    }
    ph.capture("$pageview", properties);
  }, [pathname, searchParams, ph, isLoaded, isSignedIn, user?.id, isAdmin]);

  return null;
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  );
}
