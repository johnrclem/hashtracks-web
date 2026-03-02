import { vi } from "vitest";

vi.mock("@/lib/db");

import { extractMeetupGroupUrlname } from "./suggest-source-config-action";

describe("extractMeetupGroupUrlname", () => {
  it.each([
    ["standard meetup URL with path", "https://www.meetup.com/savannah-hash-house-harriers/events/", "savannah-hash-house-harriers"],
    ["URL without trailing path", "https://meetup.com/brooklyn-hash-house-harriers", "brooklyn-hash-house-harriers"],
    ["subdomain URL", "https://www.meetup.com/some-group/", "some-group"],
  ])("extracts group name from %s", async (_, url, expected) => {
    expect(await extractMeetupGroupUrlname(url)).toBe(expected);
  });

  it.each([
    ["non-meetup URL", "https://example.com/some-path"],
    ["bare meetup.com with no path", "https://meetup.com/"],
    ["invalid URL", "not-a-url"],
    ["empty string", ""],
    ["lookalike domain notmeetup.com", "https://notmeetup.com/some-group"],
    ["meetup.com.evil domain", "https://meetup.com.evil/some-group"],
  ])("returns null for %s", async (_, url) => {
    expect(await extractMeetupGroupUrlname(url)).toBeNull();
  });
});
