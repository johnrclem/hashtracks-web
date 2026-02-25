import type { Appearance } from "@clerk/types";
import { shadcn } from "@clerk/themes";

export const clerkAppearance: Appearance = {
  baseTheme: shadcn,
  elements: {
    // Hiding Clerk branding requires a paid Clerk plan (Pro+).
    // On the free plan this override may be ignored by Clerk.
    footer: { display: "none" },
    card: { boxShadow: "none" },
  },
};
