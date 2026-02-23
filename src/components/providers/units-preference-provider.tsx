"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type TempUnit = "IMPERIAL" | "METRIC";

const STORAGE_KEY = "hashtracks:tempUnit";

interface UnitsPreferenceContextValue {
  tempUnit: TempUnit;
  setTempUnit: (unit: TempUnit) => void;
}

const UnitsPreferenceContext = createContext<UnitsPreferenceContextValue | undefined>(undefined);

export function UnitsPreferenceProvider({ children }: { children: ReactNode }) {
  const [tempUnit, setTempUnitState] = useState<TempUnit>("IMPERIAL");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "IMPERIAL" || stored === "METRIC") {
        setTempUnitState(stored);
      }
    } catch {
      // localStorage unavailable (e.g. Safari Private Browsing) — keep default
    }
  }, []);

  const setTempUnit = (unit: TempUnit) => {
    setTempUnitState(unit);
    try {
      localStorage.setItem(STORAGE_KEY, unit);
    } catch {
      // Persistence is best-effort
    }
  };

  return (
    <UnitsPreferenceContext.Provider value={{ tempUnit, setTempUnit }}>
      {children}
    </UnitsPreferenceContext.Provider>
  );
}

export function useUnitsPreference() {
  const context = useContext(UnitsPreferenceContext);
  if (context === undefined) {
    throw new Error("useUnitsPreference must be used within a UnitsPreferenceProvider");
  }
  return context;
}
