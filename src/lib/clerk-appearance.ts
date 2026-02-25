import type { Appearance } from "@clerk/types";

export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: "oklch(0.21 0.006 285.885)",
    colorText: "oklch(0.141 0.005 285.823)",
    colorTextSecondary: "oklch(0.552 0.016 285.938)",
    colorBackground: "oklch(1 0 0)",
    colorInputBackground: "oklch(1 0 0)",
    colorInputText: "oklch(0.141 0.005 285.823)",
    borderRadius: "0.625rem",
    fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  },
  elements: {
    footer: {
      display: "none",
    },
    card: {
      boxShadow: "none",
      border: "1px solid oklch(0.92 0.004 286.32)",
    },
    formButtonPrimary: {
      backgroundColor: "oklch(0.21 0.006 285.885)",
      color: "oklch(0.985 0 0)",
      borderRadius: "0.625rem",
      fontWeight: "500",
      fontSize: "0.875rem",
      textTransform: "none" as const,
    },
    socialButtonsBlockButton: {
      border: "1px solid oklch(0.92 0.004 286.32)",
      borderRadius: "0.625rem",
    },
    formFieldInput: {
      borderColor: "oklch(0.92 0.004 286.32)",
      borderRadius: "calc(0.625rem - 2px)",
    },
    headerTitle: {
      fontWeight: "700",
    },
  },
};
