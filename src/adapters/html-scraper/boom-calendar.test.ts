import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";

vi.mock("../safe-fetch", () => ({ safeFetch: vi.fn() }));
import { safeFetch } from "../safe-fetch";
import { BoomCalendarAdapter } from "./boom-calendar";

const mockSafeFetch = vi.mocked(safeFetch);

function jsonResponse(data: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(data) } as unknown as Response;
}

/** A local "YYYY-MM-DDTHH:MM" string N days from today (no offset — Boom's shape). */
function boomStart(daysFromNow: number, hhmm: string): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.toISOString().slice(0, 10)}T${hhmm}`;
}

const ACCESS_TOKENS = {
  apps: {
    "13b4a028-00fa-7133-242f-4628106b8c91": { instance: "boom.instance.jwt" },
    "other-app": { instance: "irrelevant" },
  },
};

function boomCalendar(events: unknown[]) {
  return { name: "Upcoming run", time_zone: "Asia/Taipei", country: "TW", events };
}

const SAMPLE_EVENT = {
  id: 3247511,
  title: "#181  Taoyuan 桃園",
  start: boomStart(5, "19:15"),
  end: boomStart(5, "22:45"),
  time_zone: "Asia/Taipei",
  all_day: 0,
  desc: '<p>Date/日期: 2026.7.3</p>\n<p>Time/時間: 19:30 (Hare off/鬣狗起跑)</p>\n<p>Hares/兔子: Lie Down Please / Just 年年</p>\n<p>Place/地點: 大民生平價海鮮<br>\n33041桃園市桃園區<br>\n<a href="https://maps.app.goo.gl/DABC">map</a></p>',
  venue: {
    name: "",
    address: "No. 377號, Minsheng Rd, Taoyuan District, Taoyuan City, Taiwan 33041",
    lat: 24.9994607,
    lng: 121.3106079,
  },
};

function source(config: Record<string, unknown> = { boomCompId: "comp-mcofr70d", kennelTag: "tymh3-tw", upcomingOnly: true }): Source {
  return { url: "https://www.tymh3.com/upcoming-run", config } as unknown as Source;
}

describe("BoomCalendarAdapter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("mints an instance then parses events with rich fields", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResponse(ACCESS_TOKENS))
      .mockResolvedValueOnce(jsonResponse(boomCalendar([SAMPLE_EVENT])));

    const res = await new BoomCalendarAdapter().fetch(source());
    expect(res.errors).toEqual([]);
    expect(res.events).toHaveLength(1);
    const e = res.events[0];
    expect(e.kennelTags).toEqual(["tymh3-tw"]);
    expect(e.runNumber).toBe(181);
    expect(e.title).toBe("#181 Taoyuan 桃園"); // collapsed double space
    expect(e.startTime).toBe("19:15");
    expect(e.endTime).toBe("22:45");
    expect(e.hares).toBe("Lie Down Please / Just 年年");
    expect(e.location).toBe("大民生平價海鮮"); // from desc "Place:" (venue.name blank)
    expect(e.locationStreet).toContain("Minsheng Rd");
    expect(e.latitude).toBeCloseTo(24.9994607);
    expect(e.longitude).toBeCloseTo(121.3106079);
    expect(e.locationUrl).toBe("https://maps.app.goo.gl/DABC");
  });

  it("passes the Boom instance as the ?instance= query param on the calendar call", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResponse(ACCESS_TOKENS))
      .mockResolvedValueOnce(jsonResponse(boomCalendar([SAMPLE_EVENT])));
    await new BoomCalendarAdapter().fetch(source());
    const calUrl = mockSafeFetch.mock.calls[1][0] as string;
    expect(calUrl).toContain("calendar.apiboomtech.com/api/calendar");
    expect(calUrl).toContain("comp_id=comp-mcofr70d");
    expect(calUrl).toContain("instance=boom.instance.jwt");
  });

  it("errors (suppressing reconcile) when the Boom app instance is absent", async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse({ apps: {} }));
    const res = await new BoomCalendarAdapter().fetch(source());
    expect(res.events).toEqual([]);
    expect(res.errors[0]).toMatch(/instance not found/i);
  });

  it("errors on a shape change (no events[])", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResponse(ACCESS_TOKENS))
      .mockResolvedValueOnce(jsonResponse({ name: "x" }));
    const res = await new BoomCalendarAdapter().fetch(source());
    expect(res.events).toEqual([]);
    expect(res.errors[0]).toMatch(/missing events/i);
  });

  it("returns cleanly (no error) on a genuinely empty upcoming feed", async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResponse(ACCESS_TOKENS))
      .mockResolvedValueOnce(jsonResponse(boomCalendar([])));
    const res = await new BoomCalendarAdapter().fetch(source());
    expect(res.events).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  it("windows out events far outside the ±days range", async () => {
    const farPast = { ...SAMPLE_EVENT, id: 1, start: boomStart(-400, "19:15"), end: boomStart(-400, "22:45") };
    const inWindow = { ...SAMPLE_EVENT, id: 2, start: boomStart(10, "19:15"), end: boomStart(10, "22:45") };
    mockSafeFetch
      .mockResolvedValueOnce(jsonResponse(ACCESS_TOKENS))
      .mockResolvedValueOnce(jsonResponse(boomCalendar([farPast, inWindow])));
    const res = await new BoomCalendarAdapter().fetch(source(), { days: 90 });
    expect(res.events).toHaveLength(1);
    expect(res.events[0].date).toBe(inWindow.start.slice(0, 10));
  });

  it("errors when config is missing boomCompId/kennelTag", async () => {
    const res = await new BoomCalendarAdapter().fetch(source({}));
    expect(res.events).toEqual([]);
    expect(res.errors[0]).toMatch(/missing boomCompId or kennelTag/i);
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });
});
