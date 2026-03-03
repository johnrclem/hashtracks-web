import type { CheerioAPI } from "cheerio";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A candidate container found by heuristic analysis. */
export interface ContainerCandidate {
  containerSelector: string;
  rowSelector: string;
  rowCount: number;
  sampleRows: string[][]; // First 5 rows, each row is an array of cell texts
  layoutType: "table" | "div-list" | "unknown";
}

// ─── Date detection ─────────────────────────────────────────────────────────

/** Patterns that suggest a cell contains a date. */
const DATE_PATTERNS = [
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d/i,
  /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/,
  /\b\d{1,2}(?:st|nd|rd|th)\s+\w+/i,
  /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i,
  /\b20\d{2}[/-]\d{2}[/-]\d{2}\b/, // YYYY-MM-DD
];

export function looksLikeDate(text: string): boolean {
  return DATE_PATTERNS.some((p) => p.test(text));
}

// ─── Heuristic container detection ──────────────────────────────────────────

/**
 * Find candidate event containers in an HTML page using heuristics.
 * Looks for tables and repeating div/li structures with date-like content.
 */
export function findCandidateContainers($: CheerioAPI): ContainerCandidate[] {
  const candidates: ContainerCandidate[] = [];

  // Strategy 1: Tables with date-containing rows
  $("table").each((_i, table) => {
    const rows = $(table).find("tr");
    if (rows.length < 3) return; // Too few rows

    let dateRowCount = 0;
    const sampleRows: string[][] = [];

    rows.each((j, row) => {
      const cells = $(row).find("td, th");
      const cellTexts = cells.map((_k, cell) => $(cell).text().trim()).get();
      const rowText = cellTexts.join(" ");

      if (looksLikeDate(rowText)) {
        dateRowCount++;
      }

      if (sampleRows.length < 5 && cellTexts.length > 0) {
        sampleRows.push(cellTexts);
      }
    });

    // At least 30% of rows should contain dates (skip navigation/footer tables)
    if (dateRowCount >= 3 || (dateRowCount / rows.length) > 0.3) {
      // Build a selector for this table
      const tableId = $(table).attr("id");
      const tableClass = $(table).attr("class")?.split(/\s+/)[0];

      let containerSelector: string;
      if (tableId) {
        containerSelector = `#${tableId}`;
      } else if (tableClass) {
        containerSelector = `table.${tableClass}`;
      } else {
        containerSelector = "table";
      }

      // Check if it has tbody
      const hasTbody = $(table).find("tbody").length > 0;
      const rowSelector = hasTbody ? "tbody tr" : "tr";

      candidates.push({
        containerSelector,
        rowSelector,
        rowCount: rows.length,
        sampleRows,
        layoutType: "table",
      });
    }
  });

  // Strategy 2: Repeating div/li with common class and date content
  const classGroups = new Map<string, { elements: ReturnType<typeof $>[]; dateCount: number }>();

  $("div[class], li[class], article[class]").each((_i, el) => {
    const className = $(el).attr("class")?.split(/\s+/)[0];
    if (!className) return;

    const tag = el.type === "tag" ? el.name : "div";
    const key = `${tag}.${className}`;
    const group = classGroups.get(key) ?? { elements: [], dateCount: 0 };
    group.elements.push($(el));
    if (looksLikeDate($(el).text())) {
      group.dateCount++;
    }
    classGroups.set(key, group);
  });

  for (const [selector, { elements, dateCount }] of classGroups) {
    if (elements.length < 3 || dateCount < 2) continue;

    const sampleRows: string[][] = [];
    for (const el of elements.slice(0, 5)) {
      // Extract text from immediate children or notable sub-elements
      const children = el.children();
      if (children.length > 0) {
        const cellTexts = children.map((_j, child) => $(child).text().trim()).get().filter(Boolean);
        if (cellTexts.length > 0) sampleRows.push(cellTexts);
      } else {
        sampleRows.push([el.text().trim()]);
      }
    }

    candidates.push({
      containerSelector: "body",
      rowSelector: selector,
      rowCount: elements.length,
      sampleRows,
      layoutType: "div-list",
    });
  }

  // Sort: most rows with dates first (likely the main event list)
  candidates.sort((a, b) => b.rowCount - a.rowCount);

  return candidates.slice(0, 5);
}
