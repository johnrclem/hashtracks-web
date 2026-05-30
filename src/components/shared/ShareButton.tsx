"use client";

import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface ShareButtonProps {
  /** Absolute URL, or a root-relative path (e.g. "/hareline/abc") resolved against the current origin at click time. */
  url: string;
  title: string;
  text?: string;
}

async function copyLink(resolved: string) {
  try {
    // navigator.clipboard is undefined in non-secure contexts / older browsers —
    // accessing .writeText directly would throw a TypeError.
    if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(resolved);
    toast.success("Link copied");
  } catch {
    toast.error("Couldn't copy link");
  }
}

/**
 * Share affordance: uses the Web Share API on devices that support it (mobile),
 * and falls back to copying the link to the clipboard on desktop. Styled to
 * match the outline action buttons in the event/kennel footers.
 */
export function ShareButton({ url, title, text }: Readonly<ShareButtonProps>) {
  async function handleShare() {
    // Resolve a root-relative path against the current origin. Only ever runs
    // from the click handler, so `globalThis.location` is always defined.
    const resolved = /^https?:\/\//.test(url)
      ? url
      : new URL(url, globalThis.location.origin).href;

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text, url: resolved });
      } catch (err) {
        // User cancelled the native share sheet — not an error worth surfacing.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Any other failure: fall back to copy.
        await copyLink(resolved);
      }
      return;
    }
    await copyLink(resolved);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleShare}>
      <Share2 className="mr-1.5 h-4 w-4" />
      Share
    </Button>
  );
}
