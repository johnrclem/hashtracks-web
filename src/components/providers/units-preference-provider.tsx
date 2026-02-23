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
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "IMPERIAL" || stored === "METRIC") {
      setTempUnitState(stored);
    }
  }, []);

  const setTempUnit = (unit: TempUnit) => {
    setTempUnitState(unit);
    localStorage.setItem(STORAGE_KEY, unit);
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
