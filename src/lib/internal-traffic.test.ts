import { applyAndReadInternalFlag, INTERNAL_TRAFFIC_STORAGE_KEY } from "./internal-traffic";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe("applyAndReadInternalFlag", () => {
  it("is false for an ordinary visitor", () => {
    expect(applyAndReadInternalFlag(memoryStorage(), "")).toBe(false);
  });

  it("sets the flag from ?internal=1 and keeps it on later page loads", () => {
    const storage = memoryStorage();
    expect(applyAndReadInternalFlag(storage, "?internal=1&foo=bar")).toBe(true);
    expect(storage.data.get(INTERNAL_TRAFFIC_STORAGE_KEY)).toBe("1");
    expect(applyAndReadInternalFlag(storage, "?foo=bar")).toBe(true);
  });

  it("clears the flag from ?internal=0", () => {
    const storage = memoryStorage({ [INTERNAL_TRAFFIC_STORAGE_KEY]: "1" });
    expect(applyAndReadInternalFlag(storage, "?internal=0")).toBe(false);
    expect(storage.data.has(INTERNAL_TRAFFIC_STORAGE_KEY)).toBe(false);
  });

  it("ignores other values of the parameter", () => {
    const storage = memoryStorage();
    expect(applyAndReadInternalFlag(storage, "?internal=yes")).toBe(false);
    expect(storage.data.size).toBe(0);
  });

  it("is false when storage is missing or throws", () => {
    expect(applyAndReadInternalFlag(null, "?internal=1")).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(applyAndReadInternalFlag(throwing, "?internal=1")).toBe(false);
  });
});
