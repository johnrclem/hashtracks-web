import { readFileSync } from "node:fs";
import path from "node:path";
import { REGION_SEED_DATA, regionColorClasses } from "./region";

// withDarkVariants() builds `dark:bg-<c>-900/40 dark:text-<c>-200` at runtime, so
// Tailwind only generates them because globals.css safelists them via
// `@source inline(...)`. A seed color missing from that list renders light text on a
// light badge in dark mode.
function safelistedColors(): Set<string> {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const match = /@source inline\("dark:bg-\{([a-z,]+)\}-900\/40 dark:text-\{([a-z,]+)\}-200"\)/.exec(css);
  if (!match) throw new Error("Region dark-mode @source inline safelist not found in globals.css");
  const bg = match[1].split(",");
  const text = match[2].split(",");
  expect(text).toEqual(bg);
  return new Set(bg);
}

describe("region badge dark-mode safelist", () => {
  it("safelists every color used by REGION_SEED_DATA", () => {
    const safelist = safelistedColors();
    const seedColors = new Set(
      REGION_SEED_DATA.map((r) => /bg-(\w+)-\d+/.exec(r.colorClasses)?.[1]).filter(
        (c): c is string => !!c,
      ),
    );
    const missing = [...seedColors].filter((c) => !safelist.has(c)).sort((a, b) => a.localeCompare(b));
    expect(missing).toEqual([]);
  });

  it("safelists the gray fallback for unknown regions", () => {
    expect(regionColorClasses("Nowhere Special")).toContain("dark:bg-gray-900/40");
    expect(safelistedColors().has("gray")).toBe(true);
  });
});
