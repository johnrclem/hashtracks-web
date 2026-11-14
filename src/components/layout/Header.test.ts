import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

// next-themes' resolvedTheme is undefined on the server but set on a client's
// first render, so the header's HTML must not depend on it (hydration guard).

let resolvedTheme: string | undefined;

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", resolvedTheme, setTheme: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: null }),
  SignedIn: () => null,
  SignedOut: ({ children }: { children: ReactNode }) => children,
  SignInButton: ({ children }: { children: ReactNode }) => children,
  UserButton: () => null,
}));

vi.mock("@/components/providers/time-preference-provider", () => ({
  useTimePreference: () => ({
    preference: "EVENT_LOCAL",
    setPreference: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("@/components/providers/units-preference-provider", () => ({
  useUnitsPreference: () => ({ tempUnit: "IMPERIAL", setTempUnit: vi.fn() }),
}));

const { Header } = await import("./Header");

function renderHeader(theme: string | undefined): string {
  resolvedTheme = theme;
  return renderToString(createElement(Header));
}

describe("Header theme toggle hydration", () => {
  it.each(["dark", "light"])(
    "renders the same HTML on the server and on a %s-mode client",
    (clientTheme) => {
      const serverHtml = renderHeader(undefined);
      const clientHtml = renderHeader(clientTheme);
      expect(clientHtml).toBe(serverHtml);
    },
  );

  it("lets the dark: variant pick the toggle icon instead of JS", () => {
    const html = renderHeader(undefined);
    const iconClasses = (name: string) =>
      html.match(new RegExp(`class="([^"]*lucide-${name}\\b[^"]*)"`))?.[1].split(" ") ?? [];
    expect(iconClasses("sun")).toContain("dark:hidden");
    expect(iconClasses("moon")).toEqual(expect.arrayContaining(["hidden", "dark:block"]));
  });
});
