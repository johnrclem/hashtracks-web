import { describe, it, expect } from "vitest";
import {
  parseViewtopicCdx,
  waybackRawUrl,
  extractTopicForumId,
  extractTopicTitle,
  hasExplicitEventDate,
  buildAh4Event,
} from "./backfill-ah4-wayback-history";

const REF = new Date("2023-09-20T13:59:14+00:00");

const CDX = [
  // two captures of the same topic — the NEWER must win
  "https://board.atlantahash.com/viewtopic.php?t=79 20240101000000 200",
  "https://board.atlantahash.com/viewtopic.php?t=79&sid=abc 20251001120000 200",
  "https://board.atlantahash.com/viewtopic.php?f=2&t=226 20250615000000 200",
  // bare post permalinks (no t=) are dropped — they don't map to a topic opener
  "https://board.atlantahash.com/viewtopic.php?p=332#p332 20250201000000 200",
  "https://board.atlantahash.com/viewtopic.php?p=320 20250202000000 200",
].join("\n");

describe("parseViewtopicCdx", () => {
  const snaps = parseViewtopicCdx(CDX);

  it("collapses to one snapshot per distinct topic id, dropping p=-only rows", () => {
    expect(snaps.map((s) => s.topicId)).toEqual(["79", "226"]);
  });

  it("keeps the newest capture per topic", () => {
    const s79 = snaps.find((s) => s.topicId === "79")!;
    expect(s79.timestamp).toBe("20251001120000");
    expect(s79.original).toBe("https://board.atlantahash.com/viewtopic.php?t=79&sid=abc");
  });
});

describe("waybackRawUrl", () => {
  it("builds the id_ RAW (unrewritten) capture URL", () => {
    expect(
      waybackRawUrl("20251001120000", "https://board.atlantahash.com/viewtopic.php?t=79"),
    ).toBe(
      "https://web.archive.org/web/20251001120000id_/https://board.atlantahash.com/viewtopic.php?t=79",
    );
  });
});

/** Minimal phpBB topic page: breadcrumb microdata trail + jumpbox noise +
 *  first post. `forumId` sets the deepest breadcrumb forum. */
function topicHtml(opts: {
  forumId: number;
  title: string;
  postId?: string;
  datetime?: string;
  body?: string;
}): string {
  const { forumId, title, postId = "120", datetime = "2023-09-20T13:59:14+00:00", body = "" } = opts;
  return `<!DOCTYPE html><html><head><title>${title} - Atlanta Hash House Harriers</title></head><body>
    <ul class="navbar">
      <li><a itemprop="item" href="./index.php"><span itemprop="name">Board index</span></a></li>
      <li><a itemprop="item" href="./viewforum.php?f=1&amp;sid=x"><span itemprop="name">Atlanta Area Hashes</span></a></li>
      <li><a itemprop="item" href="./viewforum.php?f=${forumId}&amp;sid=x"><span itemprop="name">A Forum</span></a></li>
    </ul>
    <h2 class="topic-title"><a href="./viewtopic.php?t=99">${title}</a></h2>
    <div id="p${postId}" class="post">
      <div class="postbody">
        <time datetime="${datetime}">then</time>
        <div class="content">${body}</div>
      </div>
    </div>
    <div class="jumpbox">
      <a href="./viewforum.php?f=4&amp;sid=x" class="jumpbox-forum-link"><span>Pinelake Hash</span></a>
      <a href="./viewforum.php?f=8&amp;sid=x" class="jumpbox-forum-link"><span>Moonlite</span></a>
    </div>
  </body></html>`;
}

describe("extractTopicForumId", () => {
  it("reads the deepest breadcrumb forum, ignoring the jumpbox dropdown", () => {
    expect(extractTopicForumId(topicHtml({ forumId: 2, title: "AH4 #2029" }))).toBe(2);
    expect(extractTopicForumId(topicHtml({ forumId: 4, title: "Pinelake #1704" }))).toBe(4);
  });

  it("returns null when no breadcrumb forum link is present", () => {
    expect(extractTopicForumId(`<div>no breadcrumbs here</div>`)).toBeNull();
  });
});

describe("extractTopicTitle", () => {
  it("reads the phpBB topic-title heading", () => {
    expect(extractTopicTitle(topicHtml({ forumId: 2, title: "Saturday 9-23 AH4#2029 1:00 PM" }))).toBe(
      "Saturday 9-23 AH4#2029 1:00 PM",
    );
  });
});

describe("hasExplicitEventDate", () => {
  it("accepts a body 'Date:' line (step 1)", () => {
    expect(hasExplicitEventDate("AH4 #2099", "Date: 09/23/2023\nKroger", REF)).toBe(true);
  });

  it("accepts a bare slash date in the body (step 1)", () => {
    expect(hasExplicitEventDate("AH4 #2099", "meet at the usual 9/23/2023 spot", REF)).toBe(true);
  });

  it("accepts a date token in the title (step 2)", () => {
    expect(hasExplicitEventDate("Saturday 9-23 AH4 #2099", "no date in body", REF)).toBe(true);
  });

  it("rejects a post with no date in title or body (would otherwise infer)", () => {
    expect(hasExplicitEventDate("Cupid Undies Run", "On on at the usual spot. BYOB.", REF)).toBe(false);
  });
});

describe("buildAh4Event", () => {
  it("builds an AH4 event with the title run number, body date, and Atom-shape sourceUrl", () => {
    const html = topicHtml({
      forumId: 2,
      title: "Start Info. Saturday AH4#2029 1:00 PM",
      postId: "120",
      body: "Date: 09/23/2023\nStart: Kroger 800 Glenwood Ave SE 30316\nTime: 1:00 PM\nHare: Hand-Tossed",
    });
    const ev = buildAh4Event(html);
    expect(ev).not.toBeNull();
    expect(ev!.date).toBe("2023-09-23");
    expect(ev!.runNumber).toBe(2029);
    expect(ev!.kennelTags).toEqual(["ah4"]);
    expect(ev!.title).toBe("Start Info. Saturday AH4#2029 1:00 PM");
    expect(ev!.sourceUrl).toBe("https://board.atlantahash.com/viewtopic.php?p=120#p120");
  });

  it("returns null for a non-AH4 (e.g. Pinelake f=4) topic", () => {
    const html = topicHtml({
      forumId: 4,
      title: "Pinelake #1704",
      body: "Date: 06/10/2023\nStart: Somewhere",
    });
    expect(buildAh4Event(html)).toBeNull();
  });

  it("returns null when the first post has no <time datetime> (refuse to fabricate a ref date)", () => {
    const html = `<ul><li><a itemprop="item" href="./viewforum.php?f=2"><span itemprop="name">AH4</span></a></li></ul>
      <h2 class="topic-title"><a>AH4 #2030</a></h2>
      <div id="p1" class="post"><div class="content">Date: 10/07/2023</div></div>`;
    expect(buildAh4Event(html)).toBeNull();
  });

  it("skips an AH4 post with a <time> but NO explicit date in title/body (no hash-day inference)", () => {
    // Forum f=2, valid <time datetime>, but neither title nor body carries a
    // date token — extractEventDate would otherwise infer "next Saturday after
    // the post timestamp". The backfill must skip, not back-date (Codex review).
    const html = topicHtml({
      forumId: 2,
      title: "AH4 #2099",
      body: "On on at the usual spot. BYOB and bring $2 hash cash.",
    });
    expect(buildAh4Event(html)).toBeNull();
  });
});
