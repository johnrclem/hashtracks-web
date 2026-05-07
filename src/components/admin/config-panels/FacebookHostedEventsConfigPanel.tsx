"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KennelTagInput, type KennelOption } from "./KennelTagInput";
import { extractFirstPathSegment } from "./url-handle";

/**
 * Form-level config shape for the FACEBOOK_HOSTED_EVENTS source type.
 *
 * Targets the dedicated `/upcoming_hosted_events` tab on a public FB Page
 * (e.g. `https://www.facebook.com/GrandStrandHashing/upcoming_hosted_events`).
 * Verified during planning research that logged-out fetches return SSR'd
 * GraphQL event data — see `src/adapters/facebook-hosted-events/` for the
 * adapter and parser.
 *
 * `upcomingOnly` is structural — the FB hosted_events tab is a partial-
 * enumeration feed (past events drop off), so the reconcile pipeline must
 * never interpret a missing past event as a cancellation. The panel always
 * emits this true so admin edits can't accidentally clear it (Codex pass-1
 * finding — without this guard, an admin save could silently re-enable
 * stale-event cancellation).
 */
export interface FacebookHostedEventsConfig {
  kennelTag?: string;
  pageHandle?: string;
  timezone?: string;
  upcomingOnly?: true;
}

interface FacebookHostedEventsConfigPanelProps {
  readonly config: FacebookHostedEventsConfig | null;
  readonly onChange: (config: FacebookHostedEventsConfig) => void;
  readonly allKennels?: KennelOption[];
}

export function FacebookHostedEventsConfigPanel({
  config,
  onChange,
  allKennels,
}: FacebookHostedEventsConfigPanelProps) {
  const current = config ?? {};
  // Local input lets the admin paste a full URL; we extract on blur.
  const [pageInput, setPageInput] = useState(current.pageHandle ?? "");

  // Wrap onChange so every persisted config includes upcomingOnly=true,
  // regardless of which field the admin just edited. Codex pass-1 finding —
  // without this, editing any field would replace the config wholesale and
  // drop the seed-set upcomingOnly bit.
  function emitChange(patch: Partial<FacebookHostedEventsConfig>) {
    onChange({ ...current, ...patch, upcomingOnly: true });
  }

  function handlePageBlur() {
    const extracted = extractFirstPathSegment(pageInput, "facebook.com");
    setPageInput(extracted);
    emitChange({ pageHandle: extracted || undefined });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fb-page-handle">Facebook Page URL or Handle *</Label>
        <Input
          id="fb-page-handle"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onBlur={handlePageBlur}
          placeholder="https://www.facebook.com/GrandStrandHashing/"
        />
        <p className="text-xs text-muted-foreground">
          Paste the full Facebook Page URL or just the handle (e.g.{" "}
          <code className="rounded bg-muted px-1">GrandStrandHashing</code>).
          The Page must be public, and events must be hosted on the Page (not
          a group). This adapter scrapes the{" "}
          <code className="rounded bg-muted px-1">/upcoming_hosted_events</code>{" "}
          tab — verify the tab is visible logged-out before saving.
        </p>
        {current.pageHandle && (
          <p className="text-xs text-muted-foreground">
            Scrape URL:{" "}
            <code className="rounded bg-muted px-1">
              facebook.com/{current.pageHandle}/upcoming_hosted_events
            </code>
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="fb-kennel-tag">Kennel Tag *</Label>
        <KennelTagInput
          id="fb-kennel-tag"
          value={current.kennelTag ?? ""}
          onChange={(v) => emitChange({ kennelTag: v || undefined })}
          allKennels={allKennels}
          placeholder="e.g. gsh3"
        />
        <p className="text-xs text-muted-foreground">
          All events from this Page are assigned to this kennel.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="fb-timezone">Kennel Timezone *</Label>
        <Input
          id="fb-timezone"
          value={current.timezone ?? ""}
          onChange={(e) => emitChange({ timezone: e.target.value || undefined })}
          placeholder="America/New_York"
        />
        <p className="text-xs text-muted-foreground">
          IANA timezone the kennel operates in. Facebook stores event times
          in UTC; we project them to the kennel&apos;s local zone for the
          canonical event date and HH:MM start time. Examples:{" "}
          <code className="rounded bg-muted px-1">America/New_York</code>,{" "}
          <code className="rounded bg-muted px-1">Europe/London</code>,{" "}
          <code className="rounded bg-muted px-1">Asia/Singapore</code>.
        </p>
      </div>
    </div>
  );
}
