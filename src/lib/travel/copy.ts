/**
 * Sign-in CTA copy shared across Travel Mode surfaces. Centralized so
 * future wording changes stay in sync — today it's used by
 * `TravelSearchForm`'s ghost-leg sign-in row and its inline
 * validation error when an anonymous user tries to add a second leg.
 *
 * Scoped narrowly to auth gates. Toast messages, save-state copy,
 * and empty-state CTAs live at their call sites (no duplication
 * today; will move here if they grow).
 */
export const AUTH_COPY = {
  signInToAddLeg: "Sign in to add leg",
  signInToPlanMultiCity: "Sign in to plan multi-city trips",
  multiCityIsFree: "Multi-city is free — just need an account",
} as const;
