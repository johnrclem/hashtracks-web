"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, Suspense, type ReactNode } from "react";
import { registerVisitRecency } from "@/lib/analytics";
import { nextPageviewVisitProperties } from "@/lib/visit-recency";

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
  registerVisitRecency();
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();
  const lastRef = useRef<string>("");

  useEffect(() => {
    if (!pathname || !ph) return;
    const url = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;
    if (url !== lastRef.current) {
      lastRef.current = url;
      const visitProperties = nextPageviewVisitProperties();
      // Keep the super property current if the local day rolled over in an open tab.
      registerVisitRecency();
      ph.capture("$pageview", { $current_url: url, ...visitProperties });
    }
  }, [pathname, searchParams, ph]);

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
