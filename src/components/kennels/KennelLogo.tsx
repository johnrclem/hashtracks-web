"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";
import { isOptimizableLogo } from "@/lib/image-remote-patterns";

interface KennelLogoProps {
  /** Logo URL, or null/undefined when the kennel has no logo. */
  logoUrl: string | null | undefined;
  /** Accessible label, e.g. `${shortName} logo`. */
  alt: string;
  /** Intrinsic size hint for the optimizer — set to the largest rendered px. */
  width: number;
  height: number;
  /** Sizing/rounding classes for the rendered <Image>. */
  className?: string;
  /** Whether to lazy-load (cards) or load eagerly (above-the-fold hero). */
  loading?: "lazy" | "eager";
  /** Rendered when there is no logo, or the image fails to load (#1300). */
  fallback: ReactNode;
}

/**
 * Renders a kennel logo via next/image (#1301) with a graceful fallback to the
 * caller's initials placeholder when `logoUrl` is absent or the asset fails to
 * load — a non-resolvable/404/http-only logo shows initials, never a broken
 * image icon (#1300). `onError` requires a client boundary, hence this small
 * client wrapper used by both the kennel hero and the directory card.
 *
 * Only first-party assets (local paths + Vercel Blob) go through the `/_next/
 * image` optimizer; arbitrary third-party logos render `unoptimized` so the
 * public optimizer is never used as a fetch proxy (see image-remote-patterns).
 */
export function KennelLogo({
  logoUrl,
  alt,
  width,
  height,
  className,
  loading = "lazy",
  fallback,
}: Readonly<KennelLogoProps>) {
  const [errored, setErrored] = useState(false);

  if (!logoUrl || errored) {
    return <>{fallback}</>;
  }

  return (
    <Image
      src={logoUrl}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      unoptimized={!isOptimizableLogo(logoUrl)}
      className={className}
      onError={() => setErrored(true)}
    />
  );
}
