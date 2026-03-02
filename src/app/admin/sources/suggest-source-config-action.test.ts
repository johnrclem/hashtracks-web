import { vi } from "vitest";

vi.mock("@/lib/db");

import { extractMeetupGroupUrlname } from "./suggest-source-config-action";

describe("extractMeetupGroupUrlname", () => {
  it("extracts group name from standard meetup URL", () => {
    expect(
      extractMeetupGroupUrlname("https://www.meetup.com/savannah-hash-house-harriers/events/"),
    ).toBe("savannah-hash-house-harriers");
  });

  it("extracts group name from URL without trailing path", () => {
    expect(
      extractMeetupGroupUrlname("https://meetup.com/brooklyn-hash-house-harriers"),
    ).toBe("brooklyn-hash-house-harriers");
  });

  it("extracts group name from subdomain URL", () => {
    expect(
      extractMeetupGroupUrlname("https://www.meetup.com/some-group/"),
    ).toBe("some-group");
  });

  it("returns null for non-meetup URL", () => {
    expect(extractMeetupGroupUrlname("https://example.com/some-path")).toBeNull();
  });

  it("returns null for bare meetup.com with no path", () => {
    expect(extractMeetupGroupUrlname("https://meetup.com/")).toBeNull();
  });

  it("returns null for invalid URL", () => {
    expect(extractMeetupGroupUrlname("not-a-url")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractMeetupGroupUrlname("")).toBeNull();
  });

  it("rejects lookalike domains like notmeetup.com", () => {
    expect(extractMeetupGroupUrlname("https://notmeetup.com/some-group")).toBeNull();
  });

  it("rejects meetup.com.evil domain", () => {
    expect(extractMeetupGroupUrlname("https://meetup.com.evil/some-group")).toBeNull();
  });
});
