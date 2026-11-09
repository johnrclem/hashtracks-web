import { createHash } from "crypto";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

/**
 * Prefix on every stored hash. Bump it whenever the skeleton rules change: hashes
 * with different prefixes are never compared, so a new algorithm starts from
 * "no baseline" instead of raising STRUCTURE_CHANGE on every source. Code from
 * before this prefix has no such guard, so don't revert past it without resetting baselines.
 */
const HASH_PREFIX = "v2:";

const VERSION_PREFIX = /^v\d+:/;

/** Safety stop for pathologically nested markup. Real templates are far shallower. */
const MAX_DEPTH = 40;

/** More differently shaped siblings than this are a list, not distinct page regions. */
const MAX_MIXED_REGIONS = 8;

/** Dropped along with everything inside them: never part of a page's layout. */
const IGNORED_TAGS = new Set([
  "applet", "area", "audio", "base", "br", "button", "canvas", "col", "colgroup",
  "datalist", "embed", "hr", "iframe", "img", "input", "ins", "link", "map", "meta",
  "noframes", "noscript", "object", "optgroup", "option", "param", "picture",
  "progress", "select", "source", "svg", "template", "textarea", "title", "track",
  "video", "wbr",
]);

/** Formatting wrappers. They vanish and their children move up; their classes follow content. */
const INLINE_TAGS = new Set([
  "a", "abbr", "acronym", "b", "bdi", "bdo", "big", "cite", "code", "data", "del",
  "dfn", "em", "font", "i", "kbd", "label", "mark", "nobr", "q", "rp", "rt", "ruby",
  "s", "samp", "small", "span", "strike", "strong", "sub", "sup", "time", "tt", "u",
  "var",
]);

/** Blocks that say nothing about the template unless a class or structure sits inside them. */
const GENERIC_BLOCK_TAGS = new Set([
  "address", "blockquote", "center", "dd", "div", "dl", "dt", "figcaption", "figure",
  "h1", "h2", "h3", "h4", "h5", "h6", "li", "ol", "p", "pre", "ul",
]);

/** Containers holding free-form writing. Only tables and repeated lists inside them count. */
const RICH_TEXT_CLASSES = new Set([
  "entry-content", "post-body", "post-content", "post-entry", "article-content",
  "wp-block-post-content", "sqs-html-content", "wixui-rich-text",
]);

/** Classes that reflect a row's position or a widget's state, not the template. */
const STATE_CLASSES = new Set([
  "active", "alt", "alternate", "closed", "collapsed", "current", "even", "expanded",
  "first", "hidden", "hover", "inactive", "last", "odd", "open", "selected", "show",
  "visible",
]);

/** Lower-case words joined by - or _. Numbered and CSS-in-JS names don't match. */
const LOWERCASE_WORDS = /^[a-z][a-z_-]*[a-z]$/;

/** camelCase or PascalCase with at least two words, like `runlistRow`. */
const CAMEL_CASE_WORDS = /^[A-Za-z][a-z]+(?:[A-Z][a-z]+)+$/;

/** Compiled names from Google Sites and Wix also mix case, but stop at six characters. */
const MIN_CAMEL_CASE_LENGTH = 7;

/** CMS classes derived from a post's own taxonomy, author, or publication state. */
const CONTENT_DERIVED_CLASS = /^(?:author|cat|category|format|post_tag|status|tag|term|tribe_events_cat)[-_]/;

/** WordPress block-editor styling flags. Core updates and page edits change these freely. */
const BLOCK_EDITOR_FLAG = /^(?:has|is)-|^align(?:center|full|left|none|right|wide)$/;

/** Core WordPress blocks an author drops into a page. Others, like `wp-block-post`, are template. */
const AUTHORED_BLOCK_CLASSES = new Set([
  "wp-block-gallery", "wp-block-heading", "wp-block-image", "wp-block-list",
  "wp-block-list-item", "wp-block-paragraph", "wp-block-quote", "wp-block-separator",
  "wp-block-spacer",
]);

/** Generated ids that happen to contain no digits, like Wix's `comp-mtjrruxy`. */
const GENERATED_ID_CLASS = /^(?:comp|css)-[a-z]+$/;

/** WordPress.com's injected toolbar. The platform changes it on every hosted site at once. */
const WORDPRESS_COM_TOOLBAR = /(?:^|\s)actnbr-/;

/** A table, or anything with one inside it, in rendered skeleton lines. */
const CONTAINS_TABLE = /^ *table(?:\.|$)/m;

/** Code-unit order. localeCompare would tie the hash to the server's locale. */
function compareStrings(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}

function isHandWrittenClass(token: string): boolean {
  if (LOWERCASE_WORDS.test(token)) return true;
  // Microsoft Word leaves Mso* classes on anything pasted from it.
  return token.length >= MIN_CAMEL_CASE_LENGTH && CAMEL_CASE_WORDS.test(token) && !token.startsWith("Mso");
}

function stableClasses(el: Element): string[] {
  const tokens = (el.attribs.class ?? "").split(/\s+/);
  const stable = tokens.filter(
    (token) =>
      isHandWrittenClass(token) &&
      !STATE_CLASSES.has(token) &&
      !CONTENT_DERIVED_CLASS.test(token) &&
      !BLOCK_EDITOR_FLAG.test(token) &&
      !GENERATED_ID_CLASS.test(token) &&
      !AUTHORED_BLOCK_CLASSES.has(token),
  );
  return sortedUnique(stable);
}

/** Script and style nodes have their own node types, so this excludes them too. */
function isElement(node: AnyNode): node is Element {
  return node.type === "tag";
}

function tagOf(el: Element): string {
  return el.name === "th" ? "td" : el.name;
}

function labelOfCell(cell: Element): string {
  return [tagOf(cell), ...stableClasses(cell)].join(".");
}

/** A row's classes mark its state (next, cancelled, a region), so rows are read by their cells. */
function labelClasses(el: Element): string[] {
  return el.name === "tr" ? [] : stableClasses(el);
}

interface SiblingGroup {
  label: string;
  members: Element[];
}

/**
 * Same-tag siblings sharing any class are one list, labelled only by the classes
 * all of them have, so a row marked `run-open` still reads as a row. A sibling
 * joins the first group it overlaps, which only matters if a site reorders
 * siblings whose classes partly overlap.
 */
function groupSiblings(children: Element[]): SiblingGroup[] {
  const groups: { tag: string; shared: string[]; seen: Set<string>; members: Element[] }[] = [];
  for (const child of children) {
    const tag = tagOf(child);
    const classes = labelClasses(child);
    const group = groups.find(
      (candidate) =>
        candidate.tag === tag &&
        (classes.length === 0 ? candidate.seen.size === 0 : classes.some((cls) => candidate.seen.has(cls))),
    );
    if (group) {
      group.members.push(child);
      group.shared = group.shared.filter((cls) => classes.includes(cls));
      for (const cls of classes) group.seen.add(cls);
    } else {
      groups.push({ tag, shared: classes, seen: new Set(classes), members: [child] });
    }
  }
  return groups.map(({ tag, shared, members }) => ({ label: [tag, ...shared].join("."), members }));
}

/** The template elements directly under `parent`, looking through inline wrappers. */
function templateChildren(parent: Element): Element[] {
  const found: Element[] = [];
  const stack: AnyNode[] = [];
  const pushReversed = (nodes: AnyNode[]) => {
    for (let i = nodes.length - 1; i >= 0; i--) stack.push(nodes[i]);
  };

  pushReversed(parent.children);
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (!isElement(node) || IGNORED_TAGS.has(node.name)) continue;
    if (WORDPRESS_COM_TOOLBAR.test(node.attribs.class ?? "")) continue;

    if (INLINE_TAGS.has(node.name)) pushReversed(node.children);
    else found.push(node);
  }
  return found;
}

/** A classed block that an author didn't compose in the editor, so it can form a list. */
function canBeListItem(el: Element): boolean {
  if (IGNORED_TAGS.has(el.name) || INLINE_TAGS.has(el.name)) return false;
  const classes = stableClasses(el);
  return classes.length > 0 && !classes.some((cls) => cls.startsWith("wp-block-"));
}

/** Authors write single notes. A lone block with classed blocks inside came from a template. */
function isStructured(el: Element): boolean {
  return el.children.filter(isElement).some(canBeListItem);
}

/**
 * What counts inside free-form writing: tables, classed blocks repeated side by
 * side, and lone classed blocks with structure of their own. Those come from a
 * plugin's list rather than from an author's hand.
 */
function listsAndTablesWithin(zone: Element): Element[] {
  const found: Element[] = [];
  const pending: Element[] = [zone];
  for (let parent = pending.pop(); parent; parent = pending.pop()) {
    const children = parent.children.filter(isElement);
    const listItems = new Set(
      groupSiblings(children.filter(canBeListItem)).flatMap(({ members }) => (members.length >= 2 || isStructured(members[0]) ? members : [])),
    );
    for (const child of children) {
      if (child.name === "table" || listItems.has(child)) found.push(child);
      else if (!IGNORED_TAGS.has(child.name)) pending.push(child);
    }
  }
  return found;
}

function sortedUnique(blocks: string[]): string[] {
  return [...new Set(blocks)].sort(compareStrings);
}

function tally(items: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

/**
 * Reduces siblings in one group. A long group, or one where most members share a
 * shape, is a list: only its most common shape stays, so a list reads the same at
 * any length and one-off rows such as month dividers disappear. A short mixed
 * group is separate regions of the page, like sidebar widgets, so each stays.
 * Ties go to the alphabetically first shape so that reordering can't flip them.
 */
function collapseSiblings(blocks: string[]): string[] {
  const counts = tally(blocks);
  const highest = Math.max(0, ...counts.values());
  if (blocks.length <= MAX_MIXED_REGIONS && highest * 2 <= blocks.length) return blocks;
  return sortedUnique(blocks.filter((block) => counts.get(block) === highest)).slice(0, 1);
}

/** A table, or a row holding one, is page layout rather than a list item, so it always stays. */
function collapseTableParts(blocks: string[]): string[] {
  const holdsTable = (block: string) => CONTAINS_TABLE.test(block);
  return [...collapseSiblings(blocks.filter((block) => !holdsTable(block))), ...blocks.filter(holdsTable)];
}

function renderChildren(children: Element[], parentName: string, depth: number): string[] {
  // Table cells keep their count and order: columns are what a table's parser depends on.
  if (parentName === "tr") {
    return children.map((child) => renderElement(child, labelOfCell(child), depth)).filter(Boolean);
  }

  const collapsed = groupSiblings(children).flatMap(({ label, members }) => {
    const blocks = members.map((member) => renderElement(member, label, depth)).filter(Boolean);
    const tag = label.split(".")[0];
    return tag === "table" || tag === "tr" ? collapseTableParts(blocks) : collapseSiblings(blocks);
  });
  return sortedUnique(collapsed);
}

/** An element and its template descendants as indented lines, or "" if it adds nothing. */
function renderElement(el: Element, label: string, depth: number): string {
  const head = " ".repeat(depth) + label;
  if (depth >= MAX_DEPTH) return head;

  const isRichText = stableClasses(el).some((cls) => RICH_TEXT_CLASSES.has(cls));
  const children = isRichText ? listsAndTablesWithin(el) : templateChildren(el);
  const body = renderChildren(children, el.name, depth + 1);
  if (body.length === 0 && GENERIC_BLOCK_TAGS.has(label)) return "";
  return [head, ...body].join("\n");
}

/**
 * Reduces a page to its template: structural tags and hand-named classes, one per
 * line, indented by depth. Text, attributes, scripts, generated class names, list
 * lengths, and free-form writing are all gone, so what remains changes when the
 * site's layout does and not when a new run is posted.
 */
export function buildStructureSkeleton(html: string): string {
  const $ = cheerio.load(html);
  const body = $("body").get(0);
  return body ? renderChildren(templateChildren(body), body.name, 0).join("\n") : "";
}

/**
 * Generate a structural fingerprint of a page: `v2:<sha256 of the skeleton>`.
 * Input with no markup (a CSV header, a list of titles) has an empty skeleton, so
 * it yields one constant hash and can never raise STRUCTURE_CHANGE.
 */
export function generateStructureHash(html: string): string {
  const digest = createHash("sha256").update(buildStructureSkeleton(html)).digest("hex");
  return `${HASH_PREFIX}${digest}`;
}

export type StructureHashComparison = "no-baseline" | "unchanged" | "changed";

function versionOf(hash: string | null | undefined): string | undefined {
  return VERSION_PREFIX.exec(hash ?? "")?.[0];
}

/**
 * Compares a stored hash with a newer one. Hashes from different algorithms,
 * including the unversioned ones from before v2, read as "no baseline": they
 * differ by construction, so the difference says nothing about the template.
 */
export function compareStructureHashes(
  previous: string | null | undefined,
  current: string | null | undefined,
): StructureHashComparison {
  const version = versionOf(previous);
  if (!version || version !== versionOf(current)) return "no-baseline";
  return previous === current ? "unchanged" : "changed";
}
