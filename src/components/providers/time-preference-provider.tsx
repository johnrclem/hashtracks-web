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
    // roll back and clobber the user's confirmed choice. Lazy-init so the
    // tracker is allocated once, not on every render.
    const trackerRef = useRef<ReturnType<typeof createRequestTracker> | null>(null);
    if (trackerRef.current === null) {
        trackerRef.current = createRequestTracker();
    }
    // Last server-confirmed (or initial) preference — the safe rollback target
    // when the latest in-flight update fails. Rolling back to a per-call
    // optimistic snapshot could strand the UI on a value the server never
    // accepted (e.g. A→B then B→C where both PATCHes fail).
    const confirmedRef = useRef<TimeDisplayPref>(initialPreference);

    // Sync state if initialPreference changes (e.g. on navigation)
    useEffect(() => {
        setPreferenceState(initialPreference);
        confirmedRef.current = initialPreference;
    }, [initialPreference]);

    const setPreference = async (newPref: TimeDisplayPref) => {
        const tracker = trackerRef.current!;
        const requestId = tracker.begin();
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
            // Server accepted this value — it's now a safe rollback baseline.
            confirmedRef.current = newPref;
        } catch (err) {
            console.error("Error setting time preference:", err);
            // Only roll back if this is still the latest intent — a stale
            // failure must not overwrite a newer confirmed value — and roll back
            // to the last server-confirmed value, never an optimistic snapshot.
            if (tracker.isLatest(requestId)) {
                setPreferenceState(confirmedRef.current);
            }
        } finally {
            // Only the latest request owns the loading flag, so an early
            // completion doesn't clear the spinner for a still-pending newer one.
            if (tracker.isLatest(requestId)) {
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
