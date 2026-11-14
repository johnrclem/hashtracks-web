"use client";

import type { ReactNode } from "react";
import { capture } from "@/lib/analytics";

interface OwnPageLinkProps {
  /** Already validated with safeUrl (see kennelOwnPageUrl). */
  href: string;
  /** Used for the click-out analytics event. */
  kennelSlug: string;
  surface: "card" | "kennel-page";
  /** Sit above a card's stretched link and keep the click from navigating the card. */
  aboveCardLink?: boolean;
  children: ReactNode;
}

/** Link out to a kennel's own page, with click analytics. */
export function OwnPageLink({
  href,
  kennelSlug,
  surface,
  aboveCardLink = false,
  children,
}: Readonly<OwnPageLinkProps>) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${aboveCardLink ? "relative z-10 " : ""}underline underline-offset-2 hover:text-foreground`}
      onClick={(e) => {
        if (aboveCardLink) e.stopPropagation();
        capture("kennel_own_page_clicked", { kennelSlug, surface });
      }}
    >
      {children}
    </a>
  );
}
