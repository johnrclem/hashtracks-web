"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KennelTagInput, type KennelOption } from "./KennelTagInput";

export interface MeetupConfig {
  groupUrlname?: string; // Meetup group URL name, e.g. "brooklyn-hash-house-harriers"
  kennelTag?: string;    // kennel shortName all events are assigned to
}

interface MeetupConfigPanelProps {
  config: MeetupConfig | null;
  onChange: (config: MeetupConfig) => void;
  allKennels?: KennelOption[];
}

/** Extract the groupUrlname from a full meetup.com URL or return the value as-is. */
function extractGroupUrlname(value: string): string {
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    if (url.hostname.includes("meetup.com")) {
      // https://www.meetup.com/brooklyn-hash-house-harriers/
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length > 0) return parts[0];
    }
  } catch {
    // not a URL — treat as raw slug
  }
  return value.trim();
}

export function MeetupConfigPanel({ config, onChange, allKennels }: MeetupConfigPanelProps) {
  const current = config ?? {};
  // Local input value so user can paste a full URL; we extract on blur
  const [urlInput, setUrlInput] = useState(current.groupUrlname ?? "");

  function handleUrlBlur() {
    const extracted = extractGroupUrlname(urlInput);
    setUrlInput(extracted);
    onChange({ ...current, groupUrlname: extracted || undefined });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="meetup-group">Meetup Group URL or Slug *</Label>
        <Input
          id="meetup-group"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onBlur={handleUrlBlur}
          placeholder="https://www.meetup.com/brooklyn-hash-house-harriers/"
        />
        <p className="text-xs text-muted-foreground">
          Paste the full Meetup group URL or just the slug (e.g.{" "}
          <code className="rounded bg-muted px-1">brooklyn-hash-house-harriers</code>).
          The group must be public — no API key required.
        </p>
        {current.groupUrlname && (
          <p className="text-xs text-muted-foreground">
            API URL:{" "}
            <code className="rounded bg-muted px-1">
              api.meetup.com/{current.groupUrlname}/events
            </code>
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="meetup-kennel-tag">Kennel Tag *</Label>
        <KennelTagInput
          id="meetup-kennel-tag"
          value={current.kennelTag ?? ""}
          onChange={(v) =>
            onChange({ ...current, kennelTag: v || undefined })
          }
          allKennels={allKennels}
          placeholder="e.g. BrH3"
        />
        <p className="text-xs text-muted-foreground">
          All events from this group are assigned to this kennel shortName.
        </p>
      </div>
    </div>
  );
}
