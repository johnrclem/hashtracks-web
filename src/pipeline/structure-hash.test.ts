import { describe, it, expect } from "vitest";
import { generateStructureHash } from "./structure-hash";

const HTML_WITH_BOTH_TABLES = `
<html><body>
<table class="past_hashes">
  <tr><td class="date">Jan 1</td><td class="info"><a href="#">Trail</a></td></tr>
  <tr><td class="date">Jan 8</td><td class="info"><a href="#">Trail 2</a></td></tr>
</table>
<table class="future_hashes">
  <tr><td class="date">Feb 1</td><td class="onin"><a href="#">Future</a></td></tr>
</table>
</body></html>
`;

const HTML_DIFFERENT_CONTENT_SAME_STRUCTURE = `
<html><body>
<table class="past_hashes">
  <tr><td class="date">Mar 15</td><td class="info"><a href="#">Different Trail</a></td></tr>
  <tr><td class="date">Mar 22</td><td class="info"><a href="#">Another Trail</a></td></tr>
</table>
<table class="future_hashes">
  <tr><td class="date">Apr 1</td><td class="onin"><a href="#">New Future</a></td></tr>
</table>
</body></html>
`;

const HTML_DIFFERENT_STRUCTURE = `
<html><body>
<table class="past_hashes">
  <tr><td class="date">Jan 1</td><td class="info"><span>Trail</span></td><td class="extra">Extra</td></tr>
</table>
<table class="future_hashes">
  <tr><td class="date">Feb 1</td><td class="info"><a href="#">Future</a></td></tr>
</table>
</body></html>
`;

const HTML_MISSING_FUTURE = `
<html><body>
<table class="past_hashes">
  <tr><td class="date">Jan 1</td><td class="info"><a href="#">Trail</a></td></tr>
</table>
</body></html>
`;

describe("generateStructureHash", () => {
  it("returns consistent hash for same HTML", () => {
    const hash1 = generateStructureHash(HTML_WITH_BOTH_TABLES);
    const hash2 = generateStructureHash(HTML_WITH_BOTH_TABLES);
    expect(hash1).toBe(hash2);
  });

  it("returns a 64-char hex string (SHA-256)", () => {
    const hash = generateStructureHash(HTML_WITH_BOTH_TABLES);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different hash for different table structure", () => {
    const hash1 = generateStructureHash(HTML_WITH_BOTH_TABLES);
    const hash2 = generateStructureHash(HTML_DIFFERENT_STRUCTURE);
    expect(hash1).not.toBe(hash2);
  });

  it("ignores text content changes (same structure → same hash)", () => {
    const hash1 = generateStructureHash(HTML_WITH_BOTH_TABLES);
    const hash2 = generateStructureHash(HTML_DIFFERENT_CONTENT_SAME_STRUCTURE);
    expect(hash1).toBe(hash2);
  });

  it("produces different hash when a table is missing", () => {
    const hashBoth = generateStructureHash(HTML_WITH_BOTH_TABLES);
    const hashMissing = generateStructureHash(HTML_MISSING_FUTURE);
    expect(hashBoth).not.toBe(hashMissing);
  });

  it("handles empty HTML gracefully", () => {
    const hash = generateStructureHash("<html><body></body></html>");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Both tables missing → different from HTML with tables
    expect(hash).not.toBe(generateStructureHash(HTML_WITH_BOTH_TABLES));
  });
});
