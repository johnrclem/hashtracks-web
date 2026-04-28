import { describe, it, expect, vi, beforeEach, beforeAll, afterEach, afterAll } from "vitest";
import type { MockInstance } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

import { revalidateTag, revalidatePath } from "next/cache";
import { safeRevalidateTag, safeRevalidatePath } from "./safe-revalidate";

const mockRevalidateTag = vi.mocked(revalidateTag);
const mockRevalidatePath = vi.mocked(revalidatePath);

function makeStaticStoreError(
  expression: string,
  opts: { withCode?: boolean } = { withCode: true },
): Error {
  const err = new Error(`Invariant: static generation store missing in ${expression}`);
  if (opts.withCode) {
    Object.defineProperty(err, "__NEXT_ERROR_CODE", {
      value: "E263",
      enumerable: false,
      configurable: true,
    });
  }
  return err;
}

describe("safeRevalidateTag", () => {
  let consoleWarnSpy: MockInstance<typeof console.warn>;

  beforeAll(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleWarnSpy.mockClear();
  });

  afterAll(() => {
    consoleWarnSpy.mockRestore();
  });

  it("forwards args to revalidateTag on the happy path", () => {
    safeRevalidateTag("hareline:events", { expire: 0 });
    expect(mockRevalidateTag).toHaveBeenCalledWith("hareline:events", { expire: 0 });
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("swallows E263 invariant and logs a warning", () => {
    mockRevalidateTag.mockImplementationOnce(() => {
      throw makeStaticStoreError("revalidateTag hareline:events");
    });

    expect(() => safeRevalidateTag("hareline:events", { expire: 0 })).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("revalidateTag(hareline:events) skipped"),
      expect.any(Error),
    );
  });

  it("swallows the invariant by message even when __NEXT_ERROR_CODE is missing", () => {
    mockRevalidateTag.mockImplementationOnce(() => {
      throw makeStaticStoreError("revalidateTag hareline:events", { withCode: false });
    });

    expect(() => safeRevalidateTag("hareline:events", { expire: 0 })).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it("re-throws unrelated errors so production cache bugs surface", () => {
    const otherErr = new Error("connection refused");
    mockRevalidateTag.mockImplementationOnce(() => {
      throw otherErr;
    });

    expect(() => safeRevalidateTag("hareline:events", { expire: 0 })).toThrow(otherErr);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("re-throws same-prefix errors that don't end in `in revalidateTag/Path`", () => {
    // A future Next.js release (or a different feature) could throw a
    // different invariant that happens to start with the same prefix.
    // We must NOT swallow it.
    const lookalike = new Error(
      "Invariant: static generation store missing in renderRSCPayload some-route",
    );
    mockRevalidateTag.mockImplementationOnce(() => {
      throw lookalike;
    });

    expect(() => safeRevalidateTag("hareline:events", { expire: 0 })).toThrow(lookalike);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe("safeRevalidatePath", () => {
  let consoleWarnSpy: MockInstance<typeof console.warn>;

  beforeAll(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleWarnSpy.mockClear();
  });

  afterAll(() => {
    consoleWarnSpy.mockRestore();
  });

  it("forwards args to revalidatePath on the happy path", () => {
    safeRevalidatePath("/hareline", "page");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/hareline", "page");
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("swallows E263 invariant and logs a warning", () => {
    mockRevalidatePath.mockImplementationOnce(() => {
      throw makeStaticStoreError("revalidatePath /hareline");
    });

    expect(() => safeRevalidatePath("/hareline")).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("revalidatePath(/hareline) skipped"),
      expect.any(Error),
    );
  });

  it("swallows the invariant by message even when __NEXT_ERROR_CODE is missing", () => {
    mockRevalidatePath.mockImplementationOnce(() => {
      throw makeStaticStoreError("revalidatePath /hareline", { withCode: false });
    });

    expect(() => safeRevalidatePath("/hareline")).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  it("re-throws unrelated errors", () => {
    const otherErr = new Error("kaboom");
    mockRevalidatePath.mockImplementationOnce(() => {
      throw otherErr;
    });

    expect(() => safeRevalidatePath("/hareline")).toThrow(otherErr);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("re-throws same-prefix errors that don't end in `in revalidateTag/Path`", () => {
    const lookalike = new Error(
      "Invariant: static generation store missing in renderRSCPayload /hareline",
    );
    mockRevalidatePath.mockImplementationOnce(() => {
      throw lookalike;
    });

    expect(() => safeRevalidatePath("/hareline")).toThrow(lookalike);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});
