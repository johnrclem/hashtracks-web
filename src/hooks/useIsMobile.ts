"use client";

import { useState, useEffect } from "react";

export const LG_BREAKPOINT = 1024;

export function useIsMobile(breakpoint = LG_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(window.innerWidth < breakpoint); // eslint-disable-line react-hooks/set-state-in-effect
  }, [breakpoint]);
  return isMobile;
}
