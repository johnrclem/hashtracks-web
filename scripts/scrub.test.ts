import { parseArgs, scrub } from "./scrub";

// Every key, token and number here is fake: same-shape filler, the reserved 555-01XX phone block
// and the RFC 2606 example domains. This repo is public.
const FAKE_GOOGLE_KEY = `AIza${"x".repeat(35)}`;

describe("scrub", () => {
  const body = `Live verify: 12 events. Contact hare at 254-555-0142 or whiff@example.com.
Fetched https://www.googleapis.com/calendar/v3/calendars/x/events?key=${FAKE_GOOGLE_KEY}`;

  it("removes secrets and personal data together", () => {
    expect(scrub(body)).toEqual({
      text: `Live verify: 12 events. Contact hare at [phone] or [email].
Fetched https://www.googleapis.com/calendar/v3/calendars/x/events?key=[secret]`,
      removals: 3,
    });
  });

  it("keeps personal data with secretsOnly", () => {
    expect(scrub(body, { secretsOnly: true }).text).toContain("254-555-0142 or whiff@example.com");
    expect(scrub(body, { secretsOnly: true }).text).toContain("?key=[secret]");
  });

  it("keeps shell references in pasted commands", () => {
    const command = 'curl "https://example.com/x?key=$GOOGLE_CALENDAR_API_KEY"';
    expect(scrub(command).text).toBe(command);
    expect(scrub(command, { secretsOnly: true }).text).toBe(command);
  });

  it("keeps an address on the kennel's own domain", () => {
    const text = "Mismanagement: gm@example-h3.org; hare: whiff@example.com";
    expect(scrub(text, { kennelWebsite: "https://www.example-h3.org" }).text).toBe(
      "Mismanagement: gm@example-h3.org; hare: [email]",
    );
  });
});

describe("parseArgs", () => {
  it.each([
    [[], {}],
    [["--secrets-only"], { secretsOnly: true }],
    [["--kennel-website", "https://example-h3.org"], { kennelWebsite: "https://example-h3.org" }],
    [["--kennel-website=https://example-h3.org"], { kennelWebsite: "https://example-h3.org" }],
  ])("parses %j", (args, expected) => {
    expect(parseArgs(args)).toEqual(expected);
  });

  it.each([[["--kennel-website"]], [["--kennel-website="]], [["--kennel-website", "--secrets-only"]], [["body.md"]]])(
    "rejects %j",
    (args) => {
      expect(parseArgs(args)).toBeNull();
    },
  );
});
