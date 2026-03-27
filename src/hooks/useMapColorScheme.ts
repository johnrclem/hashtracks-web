"use client";

import { useTheme } from "next-themes";

const DARK_MARKER_BORDER = "hsl(222 47% 11%)";

/** Returns map color scheme and marker border color based on the resolved app theme. */
export function useMapColorScheme() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return {
    colorScheme: (isDark ? "DARK" : "LIGHT") as "DARK" | "LIGHT",
    markerBorder: isDark ? DARK_MARKER_BORDER : "white",
  };
}
