import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Next.js merges root-layout metadata into every page, so a canonical set in
 * the root layout would make every page that doesn't override it claim the
 * homepage as its canonical URL. Hubs and detail pages set their own.
 * (The layout pulls in next/font, so this reads the source instead of
 * importing it.)
 */
describe("root layout metadata", () => {
  it("sets no alternates.canonical", () => {
    const source = readFileSync(path.join(__dirname, "layout.tsx"), "utf8");
    expect(source).not.toMatch(/alternates\s*:/);
    expect(source).not.toMatch(/canonical\s*:/);
  });
});
