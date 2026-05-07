"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KennelTagInput, type KennelOption } from "./KennelTagInput";
import { extractFirstPathSegment } from "./url-handle";

export interface MeetupConfig {
  groupUrlname?: string; // Meetup group URL name, e.g. "brooklyn-hash-house-harriers"
  kennelTag?: string;    // kennel shortName all events are assigned to
}

interface MeetupConfigPanelProps {
  readonly config: MeetupConfig | null;
  readonly onChange: (config: MeetupConfig) => void;
  readonly allKennels?: KennelOption[];
}

export function MeetupConfigPanel({ config, onChange, allKennels }: MeetupConfigPanelProps) {
  const current = config ?? {};
  // Local input value so user can paste a full URL; we extract on blur
  const [urlInput, setUrlInput] = useState(current.groupUrlname ?? "");

  function handleUrlBlur() {
    const extracted = extractFirstPathSegment(urlInput, "meetup.com");
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
          Scrapes the public events page — the group must be public.
        </p>
        {current.groupUrlname && (
          <p className="text-xs text-muted-foreground">
            Scrape URL:{" "}
            <code className="rounded bg-muted px-1">
              meetup.com/{current.groupUrlname}/events
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
