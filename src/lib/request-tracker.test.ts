import { createRequestTracker } from "./request-tracker";

describe("createRequestTracker (#1139)", () => {
  it("mints monotonically increasing ids", () => {
    const t = createRequestTracker();
    expect(t.begin()).toBe(1);
    expect(t.begin()).toBe(2);
    expect(t.begin()).toBe(3);
  });

  it("treats only the most recently started request as latest", () => {
    const t = createRequestTracker();
    const first = t.begin();
    const second = t.begin();
    expect(t.isLatest(first)).toBe(false);
    expect(t.isLatest(second)).toBe(true);
  });

  it("ignores a stale completion that resolves after a newer request (the A→B→C race)", () => {
    const t = createRequestTracker();
    // toggle A→B
    const patch1 = t.begin();
    // toggle B→C before patch1 resolves
    const patch2 = t.begin();
    // patch2 succeeds (latest) — its completion is authoritative
    expect(t.isLatest(patch2)).toBe(true);
    // patch1 fails late — it is NOT the latest, so its rollback must be skipped
    expect(t.isLatest(patch1)).toBe(false);
  });

  it("each tracker instance is independent", () => {
    const a = createRequestTracker();
    const b = createRequestTracker();
    a.begin();
    a.begin();
    const bId = b.begin();
    expect(b.isLatest(bId)).toBe(true);
    expect(a.isLatest(bId)).toBe(false);
  });
});
