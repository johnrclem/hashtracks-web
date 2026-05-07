import { describe, it, expect } from "vitest";
import { extractFirstPathSegment } from "./url-handle";
import { FB_RESERVED_FIRST_SEGMENTS } from "@/adapters/facebook-hosted-events/constants";

describe("extractFirstPathSegment", () => {
  it("extracts handle from a full URL on the allowed host", () => {
    expect(
      extractFirstPathSegment("https://www.facebook.com/GrandStrandHashing/", "facebook.com"),
    ).toBe("GrandStrandHashing");
  });

  it("extracts handle from a URL on a subdomain of the allowed host", () => {
    expect(extractFirstPathSegment("https://m.facebook.com/SomePage/", "facebook.com")).toBe(
      "SomePage",
    );
  });

  it("returns the trimmed input for a bare slug", () => {
    expect(extractFirstPathSegment("  GrandStrandHashing  ", "facebook.com")).toBe(
      "GrandStrandHashing",
    );
  });

  it("returns the trimmed input for a URL on a different host", () => {
    expect(extractFirstPathSegment("https://example.com/foo", "facebook.com")).toBe(
      "https://example.com/foo",
    );
  });

  it("returns the trimmed input when URL parsing fails", () => {
    expect(extractFirstPathSegment("not a url", "facebook.com")).toBe("not a url");
  });

  it("returns the trimmed input for a URL with no path segments", () => {
    expect(extractFirstPathSegment("https://www.facebook.com/", "facebook.com")).toBe(
      "https://www.facebook.com/",
    );
  });

  it("rejects reserved first segments by returning the original input", () => {
    // Pasted event URL — first segment is "events", not a Page handle.
    expect(
      extractFirstPathSegment("https://www.facebook.com/events/1012210268147290/", "facebook.com", {
        reservedFirstSegments: FB_RESERVED_FIRST_SEGMENTS,
      }),
    ).toBe("https://www.facebook.com/events/1012210268147290/");
  });

  it("matches reserved segments case-insensitively", () => {
    expect(
      extractFirstPathSegment("https://www.facebook.com/Events/foo/", "facebook.com", {
        reservedFirstSegments: FB_RESERVED_FIRST_SEGMENTS,
      }),
    ).toBe("https://www.facebook.com/Events/foo/");
  });

  it("does not reject reserved segments when no list is provided", () => {
    // Meetup uses the helper without reservedFirstSegments — should still
    // extract "events" as a literal first segment.
    expect(extractFirstPathSegment("https://www.meetup.com/events/foo", "meetup.com")).toBe(
      "events",
    );
  });
});
