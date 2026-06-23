import type { SVGProps } from "react";

/**
 * Generic Hash House Harriers foot mark — the default avatar shown when a
 * hasher has no uploaded photo and no (or hidden) account image. Pure inline
 * SVG using `currentColor`, so it inherits the surrounding text color and never
 * touches the image optimizer or a remote origin.
 */
export function HashFootMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {/* sole / ball of the foot */}
      <path d="M16 13c4.3 0 6.8 3.9 6.8 8.6 0 4.1-2.6 6.9-6.8 6.9s-6.8-2.8-6.8-6.9C9.2 16.9 11.7 13 16 13z" />
      {/* toes, big to little */}
      <ellipse cx="10.7" cy="9.6" rx="1.7" ry="2.1" />
      <ellipse cx="14.4" cy="7.6" rx="1.5" ry="1.9" />
      <ellipse cx="18" cy="7.2" rx="1.4" ry="1.8" />
      <ellipse cx="21.1" cy="7.9" rx="1.25" ry="1.6" />
      <ellipse cx="23.6" cy="9.6" rx="1.1" ry="1.4" />
    </svg>
  );
}
