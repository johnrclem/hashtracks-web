/**
 * Validation constants for the admin cancellation-override feature.
 *
 * These live in a separate non-"use server" module because the actions.ts
 * file is annotated with `"use server"`, which restricts its exports to
 * async server actions only. Importing constants from "use server" files
 * fails Next.js's Turbopack build with `Module has no exports at all`.
 *
 * Both the server action (validation) and the client dialog (textarea
 * counter, Confirm-button gate) import from here so the bounds stay in sync.
 */
export const CANCELLATION_REASON_MIN = 3;
export const CANCELLATION_REASON_MAX = 500;
