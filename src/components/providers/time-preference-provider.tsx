"use client";

import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import type { TimeDisplayPref } from "@/generated/prisma/client";

interface TimePreferenceContextValue {
    preference: TimeDisplayPref;
    setPreference: (pref: TimeDisplayPref) => void;
    isLoading: boolean;
}

const TimePreferenceContext = createContext<TimePreferenceContextValue | undefined>(undefined);

export function TimePreferenceProvider({
    children,
    initialPreference = "EVENT_LOCAL"
}: {
    children: ReactNode;
    initialPreference?: TimeDisplayPref;
}) {
    const [preference, setPreferenceState] = useState<TimeDisplayPref>(initialPreference);
    const [isLoading, setIsLoading] = useState(false);

    // Sync state if initialPreference changes (e.g. on navigation)
    useEffect(() => {
        setPreferenceState(initialPreference);
    }, [initialPreference]);

    const setPreference = async (newPref: TimeDisplayPref) => {
        // Optimistic update
        setPreferenceState(newPref);
        setIsLoading(true);

        try {
            const res = await fetch("/api/user/preferences", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ timeDisplayPref: newPref }),
            });

            if (!res.ok) {
                throw new Error("Failed to update preference");
            }
        } catch (err) {
            console.error("Error setting time preference:", err);
            // Revert on failure
            setPreferenceState(preference);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <TimePreferenceContext.Provider value={{ preference, setPreference, isLoading }}>
            {children}
        </TimePreferenceContext.Provider>
    );
}

export function useTimePreference() {
    const context = useContext(TimePreferenceContext);
    if (context === undefined) {
        throw new Error("useTimePreference must be used within a TimePreferenceProvider");
    }
    return context;
}
