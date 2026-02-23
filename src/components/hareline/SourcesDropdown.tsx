"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SourcesDropdownProps {
  sourceUrl: string | null;
  eventLinks: { id: string; url: string; label: string }[];
}

/** Only allow http/https URLs to prevent javascript: XSS. */
function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Derives a human-readable label from a source URL. */
function getLabelForUrl(url: string, existingLabel?: string | null): string {
  // Use existing label if it's descriptive (not the generic "Source" placeholder)
  if (existingLabel && existingLabel !== "Source") return existingLabel;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (hostname.includes("calendar.google.com")) return "Google Calendar";
    if (hostname.includes("hashrego.com")) return "Hash Rego";
    if (hostname.includes("meetup.com")) return "Meetup";
    return hostname;
  } catch {
    return "Source";
  }
}

/**
 * Collapses all event source URLs into a single "Sources ▾" dropdown.
 * Deduplicates by URL, filters unsafe schemes, and renders a plain
 * button when there is exactly one source.
 */
export function SourcesDropdown({ sourceUrl, eventLinks }: SourcesDropdownProps) {
  const sources: { url: string; label: string }[] = [];
  const seenUrls = new Set<string>();

  if (sourceUrl && isSafeUrl(sourceUrl)) {
    sources.push({ url: sourceUrl, label: getLabelForUrl(sourceUrl) });
    seenUrls.add(sourceUrl);
  }
  for (const link of eventLinks) {
    if (isSafeUrl(link.url) && !seenUrls.has(link.url)) {
      sources.push({ url: link.url, label: getLabelForUrl(link.url, link.label) });
      seenUrls.add(link.url);
    }
  }

  if (sources.length === 0) return null;

  if (sources.length === 1) {
    return (
      <Button variant="outline" size="sm" asChild>
        <a href={sources[0].url} target="_blank" rel="noopener noreferrer">
          {sources[0].label}
        </a>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Sources <ChevronDown className="ml-1 h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {sources.map((source) => (
          <DropdownMenuItem key={source.url} asChild>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
