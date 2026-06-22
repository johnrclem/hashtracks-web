import { describe, it, expect } from "vitest";
import { resolveAvatarSrc, avatarInitials } from "./avatar";

const BLOB = "https://abc123.public.blob.vercel-storage.com/avatar-x.png";
const CLERK = "https://img.clerk.com/eyJ0eXAi.png";

describe("resolveAvatarSrc", () => {
  it("prefers an uploaded avatar over the Clerk image", () => {
    expect(resolveAvatarSrc({ avatarUrl: BLOB, clerkImageUrl: CLERK })).toBe(BLOB);
  });

  it("falls back to the Clerk image when no upload exists", () => {
    expect(resolveAvatarSrc({ avatarUrl: null, clerkImageUrl: CLERK })).toBe(CLERK);
  });

  it("returns null (→ foot mark) when the Clerk image is hidden and there is no upload", () => {
    expect(
      resolveAvatarSrc({ avatarUrl: null, clerkImageUrl: CLERK, hideClerkImage: true }),
    ).toBeNull();
  });

  it("still shows the uploaded avatar even when the Clerk image is hidden", () => {
    expect(
      resolveAvatarSrc({ avatarUrl: BLOB, clerkImageUrl: CLERK, hideClerkImage: true }),
    ).toBe(BLOB);
  });

  it("returns null when neither an upload nor a Clerk image is present", () => {
    expect(resolveAvatarSrc({ avatarUrl: null, clerkImageUrl: null })).toBeNull();
    expect(resolveAvatarSrc({})).toBeNull();
  });

  it("ignores an unsafe avatar URL and falls through to the Clerk image", () => {
    expect(
      resolveAvatarSrc({ avatarUrl: "javascript:alert(1)", clerkImageUrl: CLERK }),
    ).toBe(CLERK);
  });

  it("ignores an unsafe Clerk image URL", () => {
    expect(
      resolveAvatarSrc({ avatarUrl: null, clerkImageUrl: "not a url" }),
    ).toBeNull();
  });
});

describe("avatarInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(avatarInitials("Just Beth")).toBe("JB");
    expect(avatarInitials("DJ Flour Sack")).toBe("DF");
  });

  it("uses a single letter for one-word names", () => {
    expect(avatarInitials("trailblazer")).toBe("T");
  });

  it("falls back to '?' for empty/nullish names", () => {
    expect(avatarInitials("")).toBe("?");
    expect(avatarInitials("   ")).toBe("?");
    expect(avatarInitials(null)).toBe("?");
    expect(avatarInitials(undefined)).toBe("?");
  });
});
