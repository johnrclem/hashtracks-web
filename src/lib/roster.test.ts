import { describe, it, expect } from "vitest";
import { assemblePastEventRoster } from "./roster";

const BLOB = "https://abc123.public.blob.vercel-storage.com/x.png";

describe("assemblePastEventRoster", () => {
  it("returns an empty list when there are no attendees or hares", () => {
    expect(assemblePastEventRoster({ attendees: [], hares: [] })).toEqual([]);
  });

  it("lists opted-in attendees, sorted by name", () => {
    const roster = assemblePastEventRoster({
      attendees: [
        { userId: "u2", hashName: "Zelda", avatarUrl: null, clerkImageUrl: null },
        { userId: "u1", hashName: "Alpha", avatarUrl: BLOB, clerkImageUrl: null },
      ],
      hares: [],
    });
    expect(roster.map((r) => r.name)).toEqual(["Alpha", "Zelda"]);
    expect(roster.every((r) => !r.isHare)).toBe(true);
    expect(roster[0].avatarSrc).toBe(BLOB);
  });

  it("always includes hares, even with no attendance, badged as hares", () => {
    const roster = assemblePastEventRoster({
      attendees: [],
      hares: [
        { userId: null, hareName: "Just Some Hare", role: "HARE" },
      ],
    });
    expect(roster).toHaveLength(1);
    expect(roster[0].name).toBe("Just Some Hare");
    expect(roster[0].isHare).toBe(true);
    expect(roster[0].avatarSrc).toBeNull();
  });

  it("prefers a linked hare's hashName over the scraped hareName", () => {
    const roster = assemblePastEventRoster({
      attendees: [],
      hares: [
        { userId: "u9", hareName: "scraped name", hashName: "Real HashName", role: "CO_HARE" },
      ],
    });
    expect(roster[0].name).toBe("Real HashName");
    expect(roster[0].hareRole).toBe("CO_HARE");
  });

  it("dedupes: a user who both hared and checked in appears once, as a hare", () => {
    const roster = assemblePastEventRoster({
      attendees: [{ userId: "u1", hashName: "Trailblazer", avatarUrl: null, clerkImageUrl: null }],
      hares: [{ userId: "u1", hareName: "Trailblazer", hashName: "Trailblazer", role: "HARE" }],
    });
    expect(roster).toHaveLength(1);
    expect(roster[0].isHare).toBe(true);
  });

  it("sorts hares before non-hare attendees", () => {
    const roster = assemblePastEventRoster({
      attendees: [{ userId: "u1", hashName: "Aardvark", avatarUrl: null, clerkImageUrl: null }],
      hares: [{ userId: "u2", hareName: "Zorro", role: "HARE" }],
    });
    expect(roster.map((r) => r.name)).toEqual(["Zorro", "Aardvark"]);
    expect(roster[0].isHare).toBe(true);
    expect(roster[1].isHare).toBe(false);
  });

  it("respects hideClerkImage when resolving an attendee avatar", () => {
    const roster = assemblePastEventRoster({
      attendees: [
        {
          userId: "u1",
          hashName: "Hidden",
          avatarUrl: null,
          clerkImageUrl: "https://img.clerk.com/a.png",
          hideClerkImage: true,
        },
      ],
      hares: [],
    });
    expect(roster[0].avatarSrc).toBeNull();
  });

  it("falls back to 'Hasher' when an attendee has no hash name", () => {
    const roster = assemblePastEventRoster({
      attendees: [{ userId: "u1", hashName: null, avatarUrl: null, clerkImageUrl: null }],
      hares: [],
    });
    expect(roster[0].name).toBe("Hasher");
  });
});
