import { parseArgs, scrub, scrubSecrets } from "./scrub";

// Every key, token and number here is fake: same-shape filler, the reserved 555-01XX phone block
// and the RFC 2606 example domains. This repo is public.
const FAKE_GOOGLE_KEY = `AIza${"x".repeat(35)}`;
const FAKE_GITHUB_TOKEN = `ghp_${"A1".repeat(18)}`;

const secrets = (text: string): string => scrubSecrets(text).text;

describe("scrubSecrets", () => {
  it.each([
    [
      "an API key in a Google Calendar URL",
      `GET https://www.googleapis.com/calendar/v3/calendars/x/events?key=${FAKE_GOOGLE_KEY}&maxResults=250`,
      "GET https://www.googleapis.com/calendar/v3/calendars/x/events?key=[secret]&maxResults=250",
    ],
    ["a token query value", "https://example.com/feed?token=abc123def", "https://example.com/feed?token=[secret]"],
    ["a signature query value", "https://example.com/a.png?w=10&sig=0f9e8d7c", "https://example.com/a.png?w=10&sig=[secret]"],
    [
      "a name that ends in a secret word",
      "https://example.com/x?access_token=t0k3n&X-Amz-Signature=deadbeef",
      "https://example.com/x?access_token=[secret]&X-Amz-Signature=[secret]",
    ],
    ["a value inside a markdown link", "[feed](https://example.com/x?key=abc)", "[feed](https://example.com/x?key=[secret])"],
    ["a bare Google API key", `"key": "${FAKE_GOOGLE_KEY}"`, `"key": "[secret]"`],
    ["a bearer token", "Authorization: Bearer abc.def-ghi_jkl-mno", "Authorization: Bearer [secret]"],
    ["an HTML-escaped query value", "/events?maxResults=250&amp;token=abc123", "/events?maxResults=250&amp;token=[secret]"],
    ["a JSON-escaped query value", String.raw`"url": "/x?a=1\u0026sig=abc123"`, String.raw`"url": "/x?a=1\u0026sig=[secret]"`],
    ["a GitHub token", `token ${FAKE_GITHUB_TOKEN} expired`, "token [secret] expired"],
    ["a Clerk secret key", `sk_live_${"k".repeat(24)}`, "[secret]"],
    [
      "credentials in a database URL",
      "connect failed: postgresql://postgres:hunter2@db.example.com:5432/railway",
      "connect failed: postgresql://[secret]@db.example.com:5432/railway",
    ],
    ["a .env line", "GOOGLE_CALENDAR_API_KEY=abc123", "GOOGLE_CALENDAR_API_KEY=[secret]"],
    ["a quoted .env value", 'CRON_SECRET="s3cr3t value"', "CRON_SECRET=[secret]"],
  ])("removes %s", (_label, input, expected) => {
    expect(secrets(input)).toBe(expected);
  });

  it.each([
    ["ordinary query values", "https://www.hashtracks.xyz/kennels/nych3?tab=events&page=2"],
    ["an env reference in a command", 'curl -H "Authorization: Bearer $TOKEN" https://www.hashtracks.xyz/api'],
    ["prose", "The bearer acknowledged that the key point is the token gesture."],
    ["a shell reference in a query", 'curl "https://example.com/x?key=$GOOGLE_CALENDAR_API_KEY"'],
    ["a shell reference in an assignment", "CRON_SECRET=$(grep -m1 '^CRON_SECRET=' .env)"],
    ["a non-secret env line", "NEXT_PUBLIC_APP_URL=https://www.hashtracks.xyz"],
  ])("keeps %s", (_label, input) => {
    expect(secrets(input)).toBe(input);
  });

  it("counts each removal once", () => {
    const text = `https://example.com/x?API_KEY=one&token=two\nBearer abcdefghijklmnopq\n${FAKE_GOOGLE_KEY}`;
    expect(scrubSecrets(text)).toEqual({
      text: "https://example.com/x?API_KEY=[secret]&token=[secret]\nBearer [secret]\n[secret]",
      removals: 4,
    });
  });
});

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
