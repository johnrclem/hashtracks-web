"use client";

import Image from "next/image";
import { useState } from "react";
import { isOptimizableLogo } from "@/lib/image-remote-patterns";
import { cn } from "@/lib/utils";
import { HashFootMark } from "./HashFootMark";

interface UserAvatarProps {
  /** Already-resolved avatar src (see `resolveAvatarSrc`), or null for the foot mark. */
  src: string | null | undefined;
  /** Accessible label, e.g. `${hashName} avatar`. */
  alt: string;
  /** Rendered px (square). */
  size?: number;
  className?: string;
}

/**
 * Renders a hasher's avatar as a circle: the resolved photo when present, else
 * the generic HHH foot mark. Mirrors `KennelLogo` — `onError` falls back to the
 * foot mark (needs a client boundary), and only first-party (Blob/local) images
 * go through the optimizer; Clerk/account images render `unoptimized`.
 */
export function UserAvatar({ src, alt, size = 40, className }: Readonly<UserAvatarProps>) {
  const [errored, setErrored] = useState(false);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground ring-1 ring-border",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src && !errored ? (
        <Image
          src={src}
          alt={alt}
          width={size}
          height={size}
          unoptimized={!isOptimizableLogo(src)}
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <HashFootMark className="h-3/5 w-3/5" role="img" aria-label={alt} />
      )}
    </span>
  );
}
