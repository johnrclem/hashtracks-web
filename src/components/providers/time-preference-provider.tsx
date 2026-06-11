"use client";

import { createContext, useContext, useState, useRef, ReactNode, useEffect } from "react";
import type { TimeDisplayPref } from "@/generated/prisma/client";
import { createRequestTracker } from "@/lib/request-tracker";

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
    // Last-write-wins guard for overlapping optimistic updates (#1139). Without
    // it, a slow PATCH that fails *after* a newer PATCH already succeeded would
    // roll back to its own stale snapshot and clobber the user's confirmed
    // choice. Persist the tracker across renders via a ref.
    const trackerRef = useRef(createRequestTracker());

    // Sync state if initialPreference changes (e.g. on navigation)
    useEffect(() => {
        setPreferenceState(initialPreference);
    }, [initialPreference]);

    const setPreference = async (newPref: TimeDisplayPref) => {
        const previousPref = preference;
        const requestId = trackerRef.current.begin();
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
            // Only roll back if this is still the latest intent — a stale
            // failure must not overwrite a newer confirmed value.
            if (trackerRef.current.isLatest(requestId)) {
                setPreferenceState(previousPref);
            }
        } finally {
            // Only the latest request owns the loading flag, so an early
            // completion doesn't clear the spinner for a still-pending newer one.
            if (trackerRef.current.isLatest(requestId)) {
                setIsLoading(false);
            }
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
