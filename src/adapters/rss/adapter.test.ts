import { describe, it, expect, vi, beforeEach } from "vitest";
import { RssAdapter } from "./adapter";
import type { Source } from "@/generated/prisma/client";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "src-1",
    url: "https://example.com/feed",
    config: { kennelTag: "TestH3" },
    ...overrides,
  } as unknown as Source;
}

// ── rss-parser mock ──────────────────────────────────────────────────────────

// Feed published 10 days ago — well within the default 90-day window
const RECENT_DATE = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
// Feed published 200 days ago — outside the window
const OLD_DATE = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
// Feed published 200 days in the future — outside the window
const FUTURE_DATE = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);

const RECENT_ITEM = {
  title: "Trail #42 — Central Park",
  isoDate: RECENT_DATE.toISOString(),
  link: "https://example.com/trail-42",
  content: "<p>Meet at the fountain. BYOB.</p>",
};

const OLD_ITEM = {
  title: "Trail #1 — Ancient History",
  isoDate: OLD_DATE.toISOString(),
  link: "https://example.com/trail-1",
  content: "Old trail",
};

const FAR_FUTURE_ITEM = {
  title: "Trail #99 — Way in the future",
  isoDate: FUTURE_DATE.toISOString(),
  link: "https://example.com/trail-99",
  content: "Future trail",
};

const NO_DATE_ITEM = {
  title: "No date item",
  content: "Some content",
};

// Use vi.hoisted so the mock fn is available before vi.mock is hoisted
const { mockParseURL } = vi.hoisted(() => ({
  mockParseURL: vi.fn(),
}));

vi.mock("rss-parser", () => {
  // Use a real class so `new Parser(...)` works
  return {
    default: class MockParser {
      parseURL(...args: unknown[]) {
        return mockParseURL(...args);
      }
    },
  };
});

beforeEach(() => {
  mockParseURL.mockResolvedValue({
    title: "Test H3 Feed",
    feedUrl: "https://example.com/feed",
    items: [RECENT_ITEM],
  });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("RssAdapter", () => {
  describe("config validation", () => {
    it("returns error for missing config", async () => {
      const adapter = new RssAdapter();
      const source = makeSource({ config: null });
      const result = await adapter.fetch(source);
      expect(result.events).toHaveLength(0);
      expect(result.errors[0]).toMatch(/config/i);
    });

    it("returns error for missing kennelTag", async () => {
      const adapter = new RssAdapter();
      const source = makeSource({ config: { groupSlug: "foo" } });
      const result = await adapter.fetch(source);
      expect(result.events).toHaveLength(0);
      expect(result.errors[0]).toMatch(/kennelTag/i);
    });
  });

  describe("fetch errors", () => {
    it("returns error when parseURL throws", async () => {
      mockParseURL.mockRejectedValueOnce(new Error("Network error"));
      const adapter = new RssAdapter();
      const result = await adapter.fetch(makeSource());
      expect(result.events).toHaveLength(0);
      expect(result.errors[0]).toMatch(/Network error/);
      expect(result.errorDetails?.fetch).toHaveLength(1);
    });
  });

  describe("successful fetch", () => {
    it("maps a basic item to RawEventData", async () => {
      const adapter = new RssAdapter();
      const result = await adapter.fetch(makeSource());
      expect(result.events).toHaveLength(1);

      const ev = result.events[0];
      expect(ev.kennelTag).toBe("TestH3");
      expect(ev.title).toBe("Trail #42 — Central Park");
      expect(ev.sourceUrl).toBe("https://example.com/trail-42");
      // date is YYYY-MM-DD
      expect(ev.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("strips HTML from content field", async () => {
      const adapter = new RssAdapter();
      const result = await adapter.fetch(makeSource());
      expect(result.events[0].description).toBe("Meet at the fountain. BYOB.");
    });

    it("preserves local date from non-UTC ISO timestamp (P1 regression)", async () => {
      // "2026-02-22T00:30:00+10:00" = Feb 21 UTC — must stay Feb 22 (publisher's local day)
      mockParseURL.mockResolvedValueOnce({
        title: "Feed",
        items: [{ title: "Night trail", isoDate: "2026-02-22T00:30:00+10:00", link: "https://x.com/1" }],
      });
      const adapter = new RssAdapter();
      const result = await adapter.fetch(makeSource(), { days: 365 });
      expect(result.events[0].date).toBe("2026-02-22");
    });

    it("falls back to pubDate when isoDate is absent", async () => {
      mockParseURL.mockResolvedValueOnce({
        title: "Feed",
        items: [{ title: "Old-style item", pubDate: RECENT_DATE.toUTCString(), link: "https://x.com/1" }],
      });
      const adapter = new RssAdapter();
      const result = await adapter.fetch(makeSource());
      expect(result.events).toHaveLength(1);
    });

    it("skips items with no date", async () => {
      mockParseURL.mockResolvedValueOnce({
        title: "Feed",
        items: [NO_DATE_ITEM],
      });
      const adapter = new RssAdapter();
      const result = await adapter.fetch(makeSource());
      expect(result.events).toHaveLength(0);
    });

    it("includes diagnosticContext with feedTitle and itemCount", async () => {
      const adapter = new RssAdapter();
      const result = await adapter.fetch(makeSource());
      expect(result.diagnosticContext?.feedTitle).toBe("Test H3 Feed");
      expect(result.diagnosticContext?.itemCount).toBe(1);
    });
  });

  describe("date window filter", () => {
    it("excludes events outside the lookback window", async () => {
      mockParseURL.mockResolvedValueOnce({
        title: "Feed",
        items: [RECENT_ITEM, OLD_ITEM],
      });
      const adapter = new RssAdapter();
      const result = await adapter.fetch(makeSource(), { days: 90 });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].title).toBe("Trail #42 — Central Park");
    });

    it("excludes events too far in the future", async () => {
      mockParseURL.mockResolvedValueOnce({
        title: "Feed",
        items: [RECENT_ITEM, FAR_FUTURE_ITEM],
      });
      const adapter = new RssAdapter();
      const result = await adapter.fetch(makeSource(), { days: 90 });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].title).toBe("Trail #42 — Central Park");
    });

    it("respects custom days option", async () => {
      // OLD_ITEM is 200 days old; with days=250 it should be in range
      mockParseURL.mockResolvedValueOnce({
        title: "Feed",
        items: [OLD_ITEM],
      });
      const adapter = new RssAdapter();
      const result = await adapter.fetch(makeSource(), { days: 250 });
      expect(result.events).toHaveLength(1);
    });
  });
});
