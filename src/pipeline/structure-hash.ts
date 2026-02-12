import { createHash } from "crypto";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

/**
 * Generate a structural fingerprint of an HTML page's content tables.
 *
 * Focuses on key structural elements the scraper depends on:
 * - Table class names (past_hashes, future_hashes)
 * - Row/cell structure within those tables
 * - CSS class names on cells (e.g., "onin")
 * - Child tag nesting patterns
 *
 * Text content and attribute values (href, id, etc.) are stripped.
 * Stable across normal content changes; changes when the site template is redesigned.
 */
export function generateStructureHash(html: string): string {
  const $ = cheerio.load(html);

  const skeleton: string[] = [];

  for (const tableClass of ["past_hashes", "future_hashes"]) {
    const table = $(`table.${tableClass}`);
    if (!table.length) {
      skeleton.push(`MISSING:${tableClass}`);
      continue;
    }

    skeleton.push(`TABLE:${tableClass}`);

    // Sample first 3 data rows to detect structure (not all rows — content varies)
    const rows = table.find("tr").slice(0, 3);
    rows.each((_i, row) => {
      const cells = $(row).find("td");
      const cellSkeleton = cells
        .map((_j, cell) => {
          const classes = $(cell).attr("class") || "";
          const childTags = $(cell)
            .children()
            .map((_k, child) => (child as AnyNode & { tagName?: string }).tagName ?? "")
            .get()
            .join(",");
          return `TD[${classes}]{${childTags}}`;
        })
        .get()
        .join("|");
      skeleton.push(`TR:${cellSkeleton}`);
    });
  }

  return createHash("sha256").update(skeleton.join("\n")).digest("hex");
}
