import {
  parseForumIndexPage,
  extractFirstPostHtml,
  extractFirstPostPublished,
  extractFirstPostId,
} from "./atlanta-forum-walker";
import { extractEventFields } from "@/adapters/html-scraper/atlanta-hash-board";
import { stripHtmlTags } from "@/adapters/utils";

// ── parseForumIndexPage ──

const INDEX_PAGE_HTML = `<!DOCTYPE html>
<html><body>
  <ul class="topiclist topics">
    <li class="row">
      <a class="topictitle" href="./viewtopic.php?f=8&amp;t=1234">Moonlite #1644 - The Wisening</a>
    </li>
    <li class="row">
      <a class="topictitle" href="./viewtopic.php?f=8&amp;t=1235">Re: Last week recap</a>
    </li>
    <li class="row">
      <a class="topictitle" href="viewtopic.php?f=8&t=1236">Monday Moonlite — 4/20 Edition</a>
    </li>
    <li class="row">
      <a class="topictitle" href="./viewtopic.php?f=8&amp;t=1234">Moonlite #1644 - The Wisening</a>
    </li>
  </ul>
</body></html>`;

describe("parseForumIndexPage", () => {
  it("extracts topictitle rows with absolute URLs", () => {
    const topics = parseForumIndexPage(INDEX_PAGE_HTML);
    expect(topics.length).toBe(3); // 4 anchors, last is sticky-dupe of #1234
    expect(topics[0].topicId).toBe("1234");
    expect(topics[0].title).toBe("Moonlite #1644 - The Wisening");
    expect(topics[0].url).toBe("https://board.atlantahash.com/viewtopic.php?f=8&t=1234");
  });

  it("normalizes relative hrefs (with and without leading ./)", () => {
    const topics = parseForumIndexPage(INDEX_PAGE_HTML);
    const urls = topics.map((t) => t.url);
    expect(urls.every((u) => u.startsWith("https://board.atlantahash.com/viewtopic.php"))).toBe(true);
  });

  it("dedupes sticky topics that repeat in the listing", () => {
    const topics = parseForumIndexPage(INDEX_PAGE_HTML);
    const ids = topics.map((t) => t.topicId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns empty array for a page with no topics", () => {
    const topics = parseForumIndexPage("<html><body><div>No posts</div></body></html>");
    expect(topics).toEqual([]);
  });
});

// ── extractFirstPostHtml ──

const TOPIC_PAGE_HTML = `<!DOCTYPE html>
<html><body>
  <div class="post" id="p1042">
    <div class="postbody">
      <p class="author">by <strong>mtmedori</strong> » <time datetime="2026-03-28T19:19:00+00:00">Sat Mar 28, 2026 3:19 pm</time></p>
      <div class="content">
        Hares: Lunar Eclipse<br>
        Where: Piedmont Park<br>
        Meet at 7, on-out at 7:25 PM
      </div>
    </div>
  </div>
  <div class="post" id="p1043">
    <div class="postbody">
      <p class="author">by <strong>OtherUser</strong> » <time datetime="2026-03-29T10:00:00+00:00">Sun Mar 29, 2026 10:00 am</time></p>
      <div class="content">Reply body — should NOT be picked up</div>
    </div>
  </div>
</body></html>`;

describe("extractFirstPostHtml", () => {
  it("returns only the first post's content div", () => {
    const html = extractFirstPostHtml(TOPIC_PAGE_HTML);
    expect(html).not.toBeNull();
    expect(html!).toContain("Hares: Lunar Eclipse");
    expect(html!).toContain("on-out at 7:25 PM");
    expect(html!).not.toContain("Reply body");
  });

  it("returns null when the page carries no .content div", () => {
    const html = extractFirstPostHtml("<html><body><div class=\"unrelated\">X</div></body></html>");
    expect(html).toBeNull();
  });
});

// ── extractFirstPostPublished ──

describe("extractFirstPostPublished", () => {
  it("returns the first <time datetime> ISO string", () => {
    expect(extractFirstPostPublished(TOPIC_PAGE_HTML)).toBe("2026-03-28T19:19:00+00:00");
  });

  it("returns null when no <time> element is present", () => {
    expect(extractFirstPostPublished("<html><body></body></html>")).toBeNull();
  });
});

// ── extractFirstPostId ──

describe("extractFirstPostId", () => {
  it("extracts numeric id from the first post's id=p<NNNN> attr", () => {
    expect(extractFirstPostId(TOPIC_PAGE_HTML)).toBe("1042");
  });

  it("returns null when no post-id attribute is present", () => {
    expect(
      extractFirstPostId('<html><body><div class="post">no id</div></body></html>'),
    ).toBeNull();
  });
});

// ── Parser parity: walker feeds the same `\n`-delimited text shape to
//    extractEventFields as the live adapter ──

describe("walker → extractEventFields parity (Codex review #1)", () => {
  it(String.raw`passes <br>-converted-to-\n text so label regexes still match`, () => {
    // Mirror the walker's body-text construction: extractFirstPostHtml() then
    // stripHtmlTags(html, "\n"). This is the parity contract that broke when
    // the walker briefly used cheerio.text() instead.
    const bodyHtml = extractFirstPostHtml(TOPIC_PAGE_HTML);
    expect(bodyHtml).not.toBeNull();
    const bodyText = stripHtmlTags(bodyHtml!, "\n");
    const fields = extractEventFields(bodyHtml!, bodyText);
    expect(fields.hares).toBe("Lunar Eclipse");
    expect(fields.location).toBe("Piedmont Park");
    expect(fields.startTime).toBe("19:25");
  });
});
