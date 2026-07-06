import { describe, it, expect } from "vitest";
import {
  parseViewtopicCdx,
  waybackRawUrl,
  extractTopicForumId,
  extractTopicTitle,
  hasExplicitEventDate,
  buildForumEvent,
} from "./atlanta-wayback-backfill";

const REF = new Date("2023-09-20T13:59:14+00:00");

const CDX = [
  "https://board.atlantahash.com/viewtopic.php?t=79 20240101000000 200",
  "https://board.atlantahash.com/viewtopic.php?t=79&sid=abc 20251001120000 200",
  "https://board.atlantahash.com/viewtopic.php?f=10&t=526 20250615000000 200",
  "https://board.atlantahash.com/viewtopic.php?p=332#p332 20250201000000 200",
].join("\n");

describe("parseViewtopicCdx", () => {
  const snaps = parseViewtopicCdx(CDX);

  it("collapses to one snapshot per topic id, dropping p=-only rows, newest wins", () => {
    expect(snaps.map((s) => s.topicId)).toEqual(["79", "526"]);
    const s79 = snaps.find((s) => s.topicId === "79")!;
    expect(s79.timestamp).toBe("20251001120000");
    expect(s79.original).toBe("https://board.atlantahash.com/viewtopic.php?t=79&sid=abc");
  });
});

describe("waybackRawUrl", () => {
  it("builds the id_ RAW capture URL", () => {
    expect(
      waybackRawUrl("20251001120000", "https://board.atlantahash.com/viewtopic.php?t=79"),
    ).toBe(
      "https://web.archive.org/web/20251001120000id_/https://board.atlantahash.com/viewtopic.php?t=79",
    );
  });
});

/** Minimal phpBB topic page: breadcrumb microdata + jumpbox noise + first post. */
function topicHtml(opts: {
  forumId: number;
  title: string;
  postId?: string;
  datetime?: string;
  body?: string;
}): string {
  const { forumId, title, postId = "768", datetime = "2023-09-20T13:59:14+00:00", body = "" } = opts;
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
    </div>
  </body></html>`;
}

describe("extractTopicForumId / extractTopicTitle", () => {
  it("reads the deepest breadcrumb forum, ignoring the jumpbox", () => {
    expect(extractTopicForumId(topicHtml({ forumId: 10, title: "SLUT # 271" }))).toBe(10);
    expect(extractTopicForumId(topicHtml({ forumId: 4, title: "Pinelake #1704" }))).toBe(4);
    expect(extractTopicForumId("<div>no breadcrumbs</div>")).toBeNull();
  });

  it("reads the phpBB topic-title heading", () => {
    expect(extractTopicTitle(topicHtml({ forumId: 10, title: "SLUT # 271 Happy SLUTty SOCO" }))).toBe(
      "SLUT # 271 Happy SLUTty SOCO",
    );
  });
});

describe("hasExplicitEventDate", () => {
  it("accepts a body 'Date:' line, a bare slash date, and a title date", () => {
    expect(hasExplicitEventDate("SLUT #271", "Date: 08/08/2025\nPublix", REF)).toBe(true);
    expect(hasExplicitEventDate("SLUT #271", "meet 8/8/2025 spot", REF)).toBe(true);
    expect(hasExplicitEventDate("Thursday 8-8 SLUT #271", "no date in body", REF)).toBe(true);
  });

  it("rejects a post with no explicit date (would otherwise infer next hash day)", () => {
    expect(hasExplicitEventDate("SLUTty Jackass", "On on at the usual spot. BYOB.", REF)).toBe(false);
  });
});

describe("buildForumEvent (generic forum harvester)", () => {
  const SLUT = { forumId: 10, kennelTag: "sluth3", hashDay: "Thursday" };

  it("extracts a space-separated '# NNN' run number during backfill (#2504/#2511)", () => {
    const html = topicHtml({
      forumId: 10,
      title: "SLUT # 271 Happy SLUTty SOCO",
      postId: "768",
      body: "Date: 08/08/2025\nWhere: Publix Parking Lot, 2900 Delk Rd SE, Marietta, GA\nTime: 7:25 PM",
    });
    const ev = buildForumEvent(html, SLUT);
    expect(ev).not.toBeNull();
    expect(ev!.date).toBe("2025-08-08");
    expect(ev!.runNumber).toBe(271); // space form — old /#(\d{2,})/ dropped this
    expect(ev!.kennelTags).toEqual(["sluth3"]);
    expect(ev!.sourceUrl).toBe("https://board.atlantahash.com/viewtopic.php?p=768#p768");
  });

  it("returns null for a topic in a different forum (f=4 Pinelake)", () => {
    const html = topicHtml({ forumId: 4, title: "Pinelake #1704", body: "Date: 06/10/2023\nStart: Somewhere" });
    expect(buildForumEvent(html, SLUT)).toBeNull();
  });

  it("skips a post with a <time> but no explicit date (no hash-day inference)", () => {
    const html = topicHtml({ forumId: 10, title: "SLUTty Jackass", body: "On on at the usual spot. BYOB." });
    expect(buildForumEvent(html, SLUT)).toBeNull();
  });

  it("builds a Pinelake event under its own forum id + tag", () => {
    const html = topicHtml({
      forumId: 4,
      title: "Pinelake number #1750 Saturday",
      postId: "500",
      body: "Date: 05/23/2026\nStart: Oak Creek Park\nTime: 1:30 PM",
    });
    const ev = buildForumEvent(html, { forumId: 4, kennelTag: "ph3-atl", hashDay: "Saturday" });
    expect(ev).not.toBeNull();
    expect(ev!.runNumber).toBe(1750);
    expect(ev!.kennelTags).toEqual(["ph3-atl"]);
  });
});
