import { describe, it, expect } from "vitest";
import { clerkAppearance } from "./clerk-appearance";

describe("clerkAppearance", () => {
  it("exports a valid appearance config with shadcn base theme", () => {
    expect(clerkAppearance).toBeDefined();
    expect(clerkAppearance.baseTheme).toBeDefined();
  });

  it("hides the Clerk footer", () => {
    const elements = clerkAppearance.elements as Record<string, unknown>;
    expect(elements.footer).toEqual({ display: "none" });
  });

  it("removes card box shadow", () => {
    const elements = clerkAppearance.elements as Record<string, unknown>;
    expect(elements.card).toEqual({ boxShadow: "none" });
  });
});
