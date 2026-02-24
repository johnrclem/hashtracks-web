import { describe, it, expect } from "vitest";
import {
  classifyUserActivity,
  sortUserActivity,
  type UserActivityItem,
} from "./UserActivitySection";

function buildItem(overrides: Partial<UserActivityItem> = {}): UserActivityItem {
  return {
    userId: "user-1",
    hashName: "Test Hasher",
    email: "test@example.com",
    status: "GOING",
    isLinked: false,
    linkedHasherId: null,
    ...overrides,
  };
}

describe("classifyUserActivity", () => {
  it("returns 'addable' for linked user not in attended set", () => {
    const item = buildItem({ isLinked: true, linkedHasherId: "hasher-1" });
    expect(classifyUserActivity(item, new Set())).toBe("addable");
  });

  it("returns 'already-recorded' for linked user already in attended set", () => {
    const item = buildItem({ isLinked: true, linkedHasherId: "hasher-1" });
    expect(classifyUserActivity(item, new Set(["hasher-1"]))).toBe("already-recorded");
  });

  it("returns 'unlinked' for unlinked user", () => {
    const item = buildItem({ isLinked: false, linkedHasherId: null });
    expect(classifyUserActivity(item, new Set())).toBe("unlinked");
  });

  it("returns 'unlinked' when isLinked is true but linkedHasherId is null (defensive)", () => {
    const item = buildItem({ isLinked: true, linkedHasherId: null });
    expect(classifyUserActivity(item, new Set())).toBe("unlinked");
  });
});

describe("sortUserActivity", () => {
  it("sorts addable first, then unlinked, then already-recorded", () => {
    const alreadyRecorded = buildItem({ userId: "u1", isLinked: true, linkedHasherId: "h1" });
    const unlinked = buildItem({ userId: "u2", isLinked: false, linkedHasherId: null });
    const addable = buildItem({ userId: "u3", isLinked: true, linkedHasherId: "h3" });

    const attended = new Set(["h1"]);
    const sorted = sortUserActivity([alreadyRecorded, unlinked, addable], attended);

    expect(sorted.map((s) => s.userId)).toEqual(["u3", "u2", "u1"]);
  });

  it("preserves order within the same state group", () => {
    const a = buildItem({ userId: "u1", isLinked: true, linkedHasherId: "h1" });
    const b = buildItem({ userId: "u2", isLinked: true, linkedHasherId: "h2" });
    const c = buildItem({ userId: "u3", isLinked: true, linkedHasherId: "h3" });

    const sorted = sortUserActivity([a, b, c], new Set());
    // All addable, original order preserved
    expect(sorted.map((s) => s.userId)).toEqual(["u1", "u2", "u3"]);
  });

  it("does not mutate the original array", () => {
    const items = [
      buildItem({ userId: "u1", isLinked: true, linkedHasherId: "h1" }),
      buildItem({ userId: "u2", isLinked: false }),
    ];
    const original = [...items];
    sortUserActivity(items, new Set(["h1"]));
    expect(items.map((i) => i.userId)).toEqual(original.map((i) => i.userId));
  });
});
