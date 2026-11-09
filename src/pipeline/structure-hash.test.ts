import { describe, it, expect } from "vitest";
import {
  buildStructureSkeleton,
  generateStructureHash,
  compareStructureHashes,
} from "./structure-hash";

const HASH_FORMAT = /^v2:[0-9a-f]{64}$/;

/** The hash every non-hashnyc page produced under the original algorithm. */
const LEGACY_CONSTANT_HASH = "ee36fdcc51" + "0".repeat(54);

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

/** Wraps a fragment in a typical CMS page frame. */
function themed(content: string): string {
  return `<!doctype html><html><head><title>Hash</title></head><body class="home page-id-7">
    <div id="page" class="site">
      <header class="site-header"><nav class="main-navigation"><ul class="menu">
        <li class="menu-item"><a href="/">Home</a></li>
        <li class="menu-item"><a href="/hareline">Hareline</a></li>
      </ul></nav></header>
      <main class="site-main">${content}</main>
      <footer class="site-footer"><div class="site-info">Copyright</div></footer>
    </div></body></html>`;
}

function row(date: string, trail: string, hares: string): string {
  return `<tr><td class="date">${date}</td><td class="trail">${trail}</td><td class="hares">${hares}</td></tr>`;
}

const hareline = (rows: string) => themed(`<table class="hareline"><tbody>${rows}</tbody></table>`);

function expectSameHash(a: string, b: string): void {
  // Compare skeletons first so a failure prints what actually differed.
  expect(buildStructureSkeleton(b)).toBe(buildStructureSkeleton(a));
  expect(generateStructureHash(b)).toBe(generateStructureHash(a));
}

function expectDifferentHash(a: string, b: string): void {
  expect(generateStructureHash(b)).not.toBe(generateStructureHash(a));
}

describe("generateStructureHash", () => {
  it("returns consistent hash for same HTML", () => {
    expectSameHash(HTML_WITH_BOTH_TABLES, HTML_WITH_BOTH_TABLES);
  });

  it("returns a version-prefixed SHA-256 hex string", () => {
    expect(generateStructureHash(HTML_WITH_BOTH_TABLES)).toMatch(HASH_FORMAT);
  });

  describe("hashnyc-shaped tables", () => {
    it("returns different hash for different table structure", () => {
      expectDifferentHash(HTML_WITH_BOTH_TABLES, HTML_DIFFERENT_STRUCTURE);
    });

    it("ignores text content changes (same structure → same hash)", () => {
      expectSameHash(HTML_WITH_BOTH_TABLES, HTML_DIFFERENT_CONTENT_SAME_STRUCTURE);
    });

    it("produces different hash when a table is missing", () => {
      expectDifferentHash(HTML_WITH_BOTH_TABLES, HTML_MISSING_FUTURE);
    });

    it("does not change when one cell's content-driven class disappears", () => {
      // hashnyc tagged a cell "onin" only when the run had an on-in. That one
      // cell flipped the old fingerprint roughly twice a week in July 2026.
      const table = (lastClass: string) => `<table class="future_hashes">
        <tr><td class="date">Feb 1</td><td class="info">A</td></tr>
        <tr><td class="date">Feb 8</td><td class="info">B</td></tr>
        <tr><td class="date">Feb 15</td><td class="${lastClass}">C</td></tr>
      </table>`;
      expectSameHash(table("info"), table("onin"));
    });
  });

  it("handles empty HTML gracefully", () => {
    const hash = generateStructureHash("<html><body></body></html>");
    expect(hash).toMatch(HASH_FORMAT);
    expect(hash).not.toBe(generateStructureHash(HTML_WITH_BOTH_TABLES));
  });

  it("gives different pages different hashes (no shared constant)", () => {
    const hashes = new Set([
      generateStructureHash(hareline(row("Jan 1", "A", "B"))),
      generateStructureHash(themed(`<div class="event-list"><div class="event-card">x</div></div>`)),
      generateStructureHash(`<html><body><table><tr><td>a</td><td>b</td></tr></table></body></html>`),
    ]);
    expect(hashes.size).toBe(3);
  });

  describe("stays stable across normal content changes", () => {
    it("ignores added and removed rows", () => {
      const one = hareline(row("Jan 1", "A", "B"));
      const many = hareline(
        Array.from({ length: 30 }, (_, i) => row(`Jan ${i + 1}`, `Trail ${i}`, `Hare ${i}`)).join(""),
      );
      expectSameHash(one, many);
    });

    it("ignores repeated cards however many there are", () => {
      const cards = (n: number) =>
        themed(
          `<div class="events">${`<div class="event"><h3 class="event-title">x</h3><div class="event-date">d</div></div>`.repeat(n)}</div>`,
        );
      expectSameHash(cards(1), cards(12));
    });

    it("ignores links, emphasis, and other inline markup in cells", () => {
      expectSameHash(
        hareline(row("Jan 1", "Trail", "Hare")),
        hareline(row("Jan 1", `<b><a href="/x">Trail</a></b><br>`, `<i><font color="red">Hare</font></i>`)),
      );
    });

    it("ignores a one-off row shape such as a month divider", () => {
      const rows = row("Jan 1", "A", "B") + row("Jan 8", "C", "D") + row("Jan 15", "E", "F");
      expectSameHash(hareline(rows), hareline(`<tr><td colspan="3">February</td></tr>${rows}`));
    });

    it("ignores zebra-striping classes", () => {
      const striped = (r: string, cls: string) => r.replace("<tr>", `<tr class="${cls}">`);
      expectSameHash(
        hareline(striped(row("Jan 1", "A", "B"), "odd")),
        hareline(striped(row("Jan 1", "A", "B"), "odd") + striped(row("Jan 8", "C", "D"), "even")),
      );
    });

    it("treats a header row and a data row as the same shape", () => {
      const header = `<tr><th>Date</th><th>Trail</th><th>Hares</th></tr>`;
      const plain = (d: string) => `<tr><td>${d}</td><td>x</td><td>y</td></tr>`;
      expectSameHash(hareline(header + plain("Jan 1")), hareline(header + plain("Jan 1") + plain("Jan 8")));
    });

    it("ignores free-form writing inside a post body", () => {
      const post = (body: string) =>
        themed(`<article class="post"><h2 class="entry-title">Run</h2><div class="entry-content">${body}</div></article>`);
      expectSameHash(
        post(`<p>Short note</p>`),
        post(`<h3>Directions</h3><ul><li>Left</li><li>Right</li></ul><div><div><p>Long</p></div></div><blockquote>On on</blockquote>`),
      );
    });

    it("reads a structured plugin list the same with one item or two", () => {
      const row = `<div class="run-row"><div class="run-date">a</div></div>`;
      const direct = (rows: string) => themed(`<div class="entry-content">${rows}</div>`);
      const wrapped = (rows: string) => direct(`<div class="hareline">${rows}</div>`);
      expectSameHash(direct(row), direct(row + row));
      expectSameHash(wrapped(row), wrapped(row + row));
    });

    it("ignores blocks an author composes inside a post body", () => {
      const post = (body: string) => themed(`<div class="entry-content">${body}</div>`);
      expectSameHash(
        post(`<p>Short note</p>`),
        post(`<h2 class="wp-block-heading">A</h2><h2 class="wp-block-heading">B</h2>
              <figure class="wp-block-image"><img src="/a.jpg"></figure>
              <div class="callout">One-off note</div>`),
      );
    });

    it("ignores bare text blocks outside a post body", () => {
      expectSameHash(
        themed(`<div class="next-run"><p>Saturday</p></div>`),
        themed(`<div class="next-run"><h2>Saturday</h2><p>Meet at noon</p><ul><li>Bring $5</li></ul></div>`),
      );
    });

    it("ignores a thumbnail link or icon that only some posts have", () => {
      const post = (extra: string) =>
        themed(`<article class="post">${extra}<h2 class="entry-title">Run</h2></article>`);
      expectSameHash(
        post(""),
        post(`<a class="post-thumbnail" href="/x"><img src="/t.jpg"></a><i class="fa-calendar"></i>`),
      );
    });

    it("ignores a lazy-loaded thumbnail whose only text is its noscript fallback", () => {
      const post = (extra: string) =>
        themed(`<article class="post">${extra}<h2 class="entry-title">Run</h2></article>`);
      expectSameHash(
        post(""),
        post(`<a class="post-thumbnail"><img data-src="/t.jpg"><noscript><img src="/t.jpg"></noscript></a>`),
      );
    });

    it("ignores repeated shapes inside an icon embedded in a post body", () => {
      const post = (body: string) => themed(`<div class="entry-content">${body}</div>`);
      expectSameHash(
        post(`<p>Short note</p>`),
        post(`<svg><path class="icon"></path><path class="icon"></path></svg>`),
      );
    });

    it("ignores a list item variant that only one event has", () => {
      const event = (extra: string) => `<li class="event"><span class="event-title">Run</span>${extra}</li>`;
      const list = (items: string) => themed(`<ul class="events">${items}</ul>`);
      expectSameHash(
        list(event("") + event("") + event("")),
        list(event("") + event("") + event(`<span class="event-location">Pub</span>`)),
      );
    });

    it("ignores WordPress block-editor styling flags", () => {
      const block = (cls: string) => themed(`<div class="wp-block-group ${cls}"><p class="${cls}">x</p></div>`);
      expectSameHash(block("has-small-font-size alignwide"), block("is-layout-flex has-text-color"));
      expectSameHash(
        themed(`<div class="wp-block-group"><p>x</p></div>`),
        themed(`<div class="wp-block-group"><p class="wp-block-paragraph">x</p></div>`),
      );
    });

    it("ignores core blocks an author adds outside a post body", () => {
      expectSameHash(
        themed(`<div class="wp-block-group"><p>x</p></div>`),
        themed(`<div class="wp-block-group"><h2 class="wp-block-heading">x</h2><ul class="wp-block-list"><li>y</li></ul></div>`),
      );
    });

    it("ignores classes that mark a row's state", () => {
      // N.E.W. Cotswold marks rows tr.next and tr.wales.
      const rows = row("Jan 1", "A", "B") + row("Jan 8", "C", "D");
      expectSameHash(
        hareline(rows),
        hareline(rows.replace("<tr>", `<tr class="next">`) + row("Jan 15", "E", "F").replace("<tr>", `<tr class="wales">`)),
      );
    });

    it("treats siblings sharing a class as one list", () => {
      // SG Harriets flags some rows shhh-hareline-run-open.
      const list = (items: string) => themed(`<div class="hareline">${items}</div>`);
      const item = (cls: string) => `<div class="${cls}">a</div>`;
      expectSameHash(
        list(item("run-row") + item("run-row") + item("run-row")),
        list(item("run-row") + item("run-row run-flag") + item("run-row run-other")),
      );
    });

    it("ignores classed inline text such as badges", () => {
      const event = (extra: string) => themed(`<div class="event"><h3 class="title">x${extra}</h3></div>`);
      expectSameHash(event(""), event(`<span class="new-badge">New</span>`));
    });

    it("ignores the WordPress.com toolbar", () => {
      expectSameHash(
        hareline(row("Jan 1", "A", "B")),
        hareline(row("Jan 1", "A", "B")).replace(
          `<main class="site-main">`,
          `<div id="actionbar" class="actnbr-pub-wilson"><ul><li class="actnbr-btn">Follow</li></ul></div><main class="site-main">`,
        ),
      );
    });

    it("ignores generated ids with no digits", () => {
      const wrap = (cls: string) => themed(`<section class="wixui-section ${cls}"><div class="event">x</div></section>`);
      expectSameHash(wrap("comp-mtjrruxy"), wrap("comp-liczzhee"));
      expectSameHash(wrap("css-snrzpw"), wrap("css-fmgaaj"));
    });

    it("ignores text formatting inside a Wix rich-text block", () => {
      const block = (body: string) => themed(`<div class="wixui-rich-text">${body}</div>`);
      expectSameHash(
        block(`<p class="wixui-rich-text__text">a</p>`),
        block(`<h2 class="wixui-rich-text__text">a</h2><p class="wixui-rich-text__text">b</p><ul class="wixui-rich-text__text"><li>c</li></ul>`),
      );
    });

    it("ignores classes pasted in from Word and compiled Google Sites names", () => {
      const wrap = (cls: string) => themed(`<div class="event-list"><p class="${cls}">x</p></div>`);
      expectSameHash(wrap("MsoNormal"), wrap("hUphyc"));
    });

    it("ignores how many tables of the same shape a page has", () => {
      const table = `<table><tr><td class="date">a</td><td class="trail">b</td></tr></table>`;
      expectSameHash(themed(table), themed(`<h2>March</h2>${table}<h2>April</h2>${table}${table}`));
    });
  });

  describe("ignores markup that changes on every request", () => {
    it("ignores scripts, styles, comments, and ad slots", () => {
      expectSameHash(
        hareline(row("Jan 1", "A", "B")),
        hareline(row("Jan 1", "A", "B")).replace(
          `<main class="site-main">`,
          `<!-- cache 12345 --><script nonce="abc">var x=1;</script><style>.a{}</style>
           <noscript><div class="fallback">x</div></noscript>
           <ins class="adsbygoogle"></ins><iframe src="https://ads.example/1"></iframe>
           <main class="site-main">`,
        ),
      );
    });

    it("ignores ids, nonces, and data attributes", () => {
      const withAttrs = (id: string, nonce: string) =>
        themed(`<div id="${id}" data-nonce="${nonce}" data-ts="${nonce}" class="event-list" style="top:${nonce}px">
          <div class="event">x</div></div>`);
      expectSameHash(withAttrs("comp-abc123", "111"), withAttrs("comp-xyz789", "222"));
    });

    it("ignores generated class names", () => {
      const wrap = (cls: string) => themed(`<div class="event-list ${cls}"><div class="event">x</div></div>`);
      // WordPress ids, numbered variants, CSS-in-JS, and compiled Wix/Google Sites classes.
      expectSameHash(wrap("post-1234 page-id-7"), wrap("post-5678 page-id-9"));
      expectSameHash(wrap("css-1q2w3e"), wrap("css-9o8i7u"));
      expectSameHash(wrap("KaEeLN MW5IWV"), wrap("Ft7HRd zfr3Q"));
    });

    it("ignores per-post taxonomy classes", () => {
      const article = (cls: string) =>
        themed(`<article class="post type-post hentry ${cls}"><h2 class="entry-title">x</h2></article>`);
      expectSameHash(
        article("category-trail-reports tag-beer author-mudflap"),
        article("category-announcements tag-shiggy author-just-bob"),
      );
    });

    it("does not depend on the order of class names", () => {
      expectSameHash(
        themed(`<div class="event-list featured">x<div class="a-b">y</div></div>`),
        themed(`<div class="featured event-list">x<div class="a-b">y</div></div>`),
      );
    });
  });

  describe("changes when the template changes", () => {
    it("detects an added table column", () => {
      expectDifferentHash(
        hareline(row("Jan 1", "A", "B")),
        hareline(row("Jan 1", "A", "B").replace("</tr>", `<td class="cost">$5</td></tr>`)),
      );
    });

    it("detects a swapped table column order", () => {
      expectDifferentHash(
        hareline(`<tr><td class="date">a</td><td class="hares">b</td></tr>`),
        hareline(`<tr><td class="hares">b</td><td class="date">a</td></tr>`),
      );
    });

    it("detects a table replaced by cards", () => {
      expectDifferentHash(
        hareline(row("Jan 1", "A", "B")),
        themed(`<div class="hareline"><div class="card">Jan 1</div></div>`),
      );
    });

    it("detects a renamed container class", () => {
      expectDifferentHash(
        themed(`<div class="event-list"><div class="event">x</div></div>`),
        themed(`<div class="run-list"><div class="event">x</div></div>`),
      );
    });

    it("detects a theme change around identical content", () => {
      expectDifferentHash(
        hareline(row("Jan 1", "A", "B")),
        `<html><body><div class="wrapper"><section class="content-area">
          <table class="hareline"><tbody>${row("Jan 1", "A", "B")}</tbody></table>
        </section></div></body></html>`,
      );
    });

    it("detects a renamed camelCase class", () => {
      // London Hash's parser depends on classes like runlistRow.
      expectDifferentHash(
        themed(`<div class="runlistRow">x</div>`),
        themed(`<div class="runlistEntry">x</div>`),
      );
    });

    const nestedInLayoutTable = (table: string) => `<html><body><table>
      <tr><td>banner</td></tr><tr><td>nav</td></tr><tr><td>spacer</td></tr>
      <tr><td>${table}</td></tr>
    </table></body></html>`;
    const navTable = `<table><tr><td>a</td></tr></table>`;

    it.each<[string, (table: string) => string]>([
      ["inside <center>", (table) => `<html><body><center>${table}</center></body></html>`],
      ["nested in a layout table", nestedInLayoutTable],
      ["among differently shaped tables", (table) => themed(navTable + navTable + table)],
      ["inside a post body", (table) => themed(`<div class="entry-content"><p>Hareline</p>${table}</div>`)],
    ])("detects a column added to a table %s", (_where, page) => {
      expectDifferentHash(
        page(`<table><tr><td>a</td><td>b</td></tr></table>`),
        page(`<table><tr><td>a</td><td>b</td><td>c</td></tr></table>`),
      );
    });

    it("detects a change in one of several unclassed page regions", () => {
      const page = (region: string) =>
        `<html><body><div><ul class="menu"><li>a</li></ul></div><div>${region}</div></body></html>`;
      expectDifferentHash(page(`<div class="event">x</div>`), page(`<div class="run">x</div>`));
    });

    it("detects a redesigned plugin list inside a post body", () => {
      // SG Harriets' run rows, for example, live inside .entry-content.
      const page = (cls: string) =>
        themed(`<div class="entry-content"><div class="hareline">
          <div class="${cls}">a</div><div class="${cls}">b</div><div class="${cls}">c</div>
        </div></div>`);
      expectDifferentHash(page("run-row"), page("event-row"));
    });

    it("detects a block page served in place of the real page", () => {
      expectDifferentHash(
        hareline(row("Jan 1", "A", "B")),
        `<html><body><div class="cf-browser-verification"><div class="cf-spinner"></div></div></body></html>`,
      );
    });
  });

  describe("input that is not HTML", () => {
    it("does not throw, and text changes do not move the hash", () => {
      expectSameHash("Run 1 - Beer Mile\nRun 2 - Shiggy", "Run 3 - Campout\nRun 4 - Red Dress");
      expectSameHash("Date,Hares,Location", "");
    });

    it("handles RSS feeds without depending on item count", () => {
      const feed = (items: string) =>
        `<?xml version="1.0"?><rss><channel><title>Blog</title>${items}</channel></rss>`;
      const item = `<item><title>Run</title><link>https://x</link><description>y</description></item>`;
      expectSameHash(feed(item), feed(item.repeat(10)));
    });

    it("survives a pathologically deep document", () => {
      const deep = "<div class=\"a\">".repeat(20_000) + "x" + "</div>".repeat(20_000);
      expect(generateStructureHash(deep)).toMatch(HASH_FORMAT);
    });
  });
});

describe("hash stability", () => {
  const GOLDEN_PAGE = `<html><body>
    <div id="page" class="site post-123 active category-runs has-text-color">
      <header class="site-header"><nav class="runlistNav"><ul><li class="menu-item"><a href="/">Home</a></li></ul></nav></header>
      <center><table class="hareline">
        <thead><tr><th>Date</th><th class="hares">Hares</th></tr></thead>
        <tbody><tr class="odd"><td>a</td><td class="hares">b</td></tr><tr class="even"><td>c</td><td class="hares">d</td></tr></tbody>
      </table></center>
      <div class="entry-content"><p class="wp-block-paragraph">x</p><div class="run"><span class="date">d</span></div><div class="run"><span class="date">e</span></div></div>
      <article class="post"><a class="post-thumbnail"><img src="t.jpg"></a><h2 class="entry-title">Run</h2></article>
      <footer><div><span class="MsoNormal">c</span></div></footer>
    </div>
  </body></html>`;

  it("keeps an exact hash for a known page", () => {
    // If this fails, the skeleton rules changed. Bump HASH_PREFIX, or the next scrape
    // raises STRUCTURE_CHANGE on every affected source, then update this value.
    expect(generateStructureHash(GOLDEN_PAGE)).toBe("v2:1747f5bf4d6a091251c5c45984235afb9be043544238382e1f975913f9b6fd37");
  });
});

describe("buildStructureSkeleton", () => {
  it("renders one template element per line, indented by depth", () => {
    const skeleton = buildStructureSkeleton(
      `<html><body><div class="wrap"><table class="runs"><tr><td class="day">1</td><td>2</td></tr></table></div></body></html>`,
    );
    expect(skeleton.split("\n")).toEqual([
      "div.wrap",
      " table.runs",
      "  tbody",
      "   tr",
      "    td.day",
      "    td",
    ]);
  });
});

describe("compareStructureHashes", () => {
  const current = generateStructureHash(HTML_WITH_BOTH_TABLES);
  const other = generateStructureHash(HTML_MISSING_FUTURE);

  it("reports whether two hashes from one algorithm match", () => {
    expect(compareStructureHashes(current, current)).toBe("unchanged");
    expect(compareStructureHashes(other, current)).toBe("changed");
  });

  it.each([
    ["the legacy shared constant", LEGACY_CONSTANT_HASH],
    ["any other unversioned hash", `c187175750${"a".repeat(54)}`],
    ["a hash from another version", `v9:${"a".repeat(64)}`],
    ["nothing at all", null],
  ])("treats %s as no baseline", (_label, previous) => {
    expect(compareStructureHashes(previous, current)).toBe("no-baseline");
  });

  it("still compares hashes from an older version with each other", () => {
    const oldA = `v1:${"a".repeat(64)}`;
    const oldB = `v1:${"b".repeat(64)}`;
    expect(compareStructureHashes(oldA, oldB)).toBe("changed");
  });

  it("gives no baseline when either side is missing or unversioned", () => {
    expect(compareStructureHashes(current, `v9:${"a".repeat(64)}`)).toBe("no-baseline");
    expect(compareStructureHashes(current, null)).toBe("no-baseline");
    expect(compareStructureHashes(LEGACY_CONSTANT_HASH, LEGACY_CONSTANT_HASH)).toBe("no-baseline");
  });
});
