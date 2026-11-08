import { emitIdentityMarker } from "@/lib/audit-canonical";
import { AUDIT_STREAM } from "@/lib/audit-stream-meta";
import { redactFinding, redactPersonalData } from "./audit-redact";

// Every number and address here is fictional on purpose: this repo is public, so
// a real hasher's contact details must never be copied in as a fixture. NANP
// numbers use the reserved 555-01XX block, UK/AU/FR use their regulators' drama
// ranges, others are zero-filled, and emails use the RFC 2606 example domains.

const redact = (text: string, kennelWebsite?: string | null): string =>
  redactPersonalData(text, kennelWebsite).text;

describe("redactPersonalData — phone formats", () => {
  it.each([
    ["dashed", "254-555-0142"],
    ["spaced", "254 555 0142"],
    ["dotted", "254.555.0142"],
    ["mixed separators", "254 555-0142"],
    ["parens with space", "(254) 555-0142"],
    ["parens without space", "(412)555-0199"],
    ["bare 10-digit", "5045550123"],
    ["bare 11-digit with country code", "15045550123"],
    ["+1 dashed", "+1-254-555-0142"],
    ["1 dashed", "1-254-555-0142"],
    ["+1 parens", "+1 (254) 555-0142"],
    ["7-digit local", "555-0144"],
    ["international compact", "+447700900123"],
    ["international spaced", "+44 7700 900123"],
    ["international with trunk zero", "+49 (0)30 0000 0000"],
    ["international three-digit code", "+966 50 000 0000"],
    ["AU mobile", "0491 570 156"],
    ["UK mobile", "07700 900123"],
    ["UK landline", "020 7946 0958"],
    ["AU landline with parens", "(02) 5550 1234"],
    ["JP mobile", "090-0000-0000"],
    ["KR mobile", "010-0000-0000"],
    ["bare national mobile", "07700900123"],
    ["French pairs", "01 99 00 12 34"],
  ])("redacts %s", (_label, phone) => {
    expect(redact(`Hare: Whiff (${phone}) on trail`)).toBe("Hare: Whiff ([phone]) on trail");
  });

  it.each([
    ["contact word + spaced 7-digit", "call 555 0144", "call [phone]"],
    ["contact word + dotted 7-digit", "Tel 555.0144", "Tel [phone]"],
    ["contact word + bare 7-digit", "WhatsApp 5550144", "WhatsApp [phone]"],
    ["contact word + 4-4", "text 5550-0144", "text [phone]"],
    ["contact word + bare 8-digit", "Phone: 55500144", "Phone: [phone]"],
    ["hotline with country prefix", "Hotline: 65 5550-0144", "Hotline: [phone]"],
  ])("redacts ambiguous shapes after a %s", (_label, input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it.each([
    ["string start", "254-555-0142 is the hare", "[phone] is the hare"],
    ["sentence end", "Call 254-555-0142.", "Call [phone]."],
    ["inline code", "reads `254-555-0142` here", "reads `[phone]` here"],
    ["bold", "**254-555-0142**", "**[phone]**"],
    ["table cell", "| 254-555-0142 |", "| [phone] |"],
    ["no space after colon", "Phone:254-555-0142", "Phone:[phone]"],
    ["quotes", '"254-555-0142"', '"[phone]"'],
    ["tel link", "[ring](tel:+12545550142)", "[ring](tel:[phone])"],
    ["hyphen after", "254-555-0142-John", "[phone]-John"],
    ["nested parens", "Whiff ((412)555-0199)", "Whiff ([phone])"],
    ["slash-separated pair", "254-555-0142/254-555-0143", "[phone]/[phone]"],
    ["slash-separated bare pair", "5045550123/5045550124", "[phone]/[phone]"],
    ["slash-separated local pair", "555-0144/555-0145", "[phone]/[phone]"],
    ["no-break space after parens", "(254) 555-0142", "[phone]"],
    ["no-break hyphens", "254‑555‑0142", "[phone]"],
    ["no-break spaces", "254 555 0142", "[phone]"],
  ])("finds a phone at %s", (_label, input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it.each(["event", "run", "page"])("redacts a bare 10-digit number after the word %s", (word) => {
    expect(redact(`hare for ${word} 5045550123`)).toBe(`hare for ${word} [phone]`);
  });

  it("redacts every occurrence and counts them", () => {
    const result = redactPersonalData("A 254-555-0142, B 254-555-0143, C hare@example.com");
    expect(result).toEqual({ text: "A [phone], B [phone], C [email]", redactions: 3 });
  });
});

describe("redactPersonalData — email formats", () => {
  it.each([
    ["plain", "hare.line@example.com"],
    ["plus tag and multi-part domain", "gm+hash@mail.example.co.uk"],
    ["uppercase", "HARE@EXAMPLE.COM"],
    ["underscore and digits", "hare_2026@example.net"],
  ])("redacts %s", (_label, email) => {
    expect(redact(`Contact ${email} for details`)).toBe("Contact [email] for details");
  });

  it.each([
    ["a mailto link", "[mail](mailto:hare@example.com?subject=Run)", "[mail](mailto:[email]?subject=Run)"],
    ["a percent-encoded address", "src=hare%40example.com", "src=[email]"],
    ["an address in a URL query", "https://example.com/c?who=hare@example.com&x=1", "https://example.com/c?who=[email]&x=1"],
  ])("redacts %s", (_label, input, expected) => {
    expect(redact(input)).toBe(expected);
  });
});

describe("redactPersonalData — kennel-published contacts", () => {
  it.each([
    ["a club address on the kennel's own domain", "contact@kennel.example.org", "https://www.kennel.example.org/about"],
    ["an address on a subdomain of that domain", "gm@mail.kennel.example.org", "https://kennel.example.org"],
    ["an address when the stored website has no scheme", "gm@kennel.example.org", "www.kennel.example.org"],
  ])("keeps %s", (_label, address, website) => {
    expect(redact(address, website)).toBe(address);
  });

  it.each([
    ["an address on any other domain", "hare@example.com", "https://kennel.example.org"],
    ["an address on a shared host's parent domain", "hare@wordpress.example", "https://kennel.wordpress.example"],
    ["an address on a lookalike domain", "hare@notkennel.example.org", "https://kennel.example.org"],
    ["an address with the kennel's domain hidden in its local part", "x%40kennel.example.org@example.com", "https://kennel.example.org"],
    ["every address when the website is null", "contact@kennel.example.org", null],
    ["every address when the website is unset", "contact@kennel.example.org", undefined],
    ["every address when the website is malformed", "contact@kennel.example.org", "not a url at all"],
  ])("redacts %s", (_label, address, website) => {
    expect(redact(address, website)).toBe("[email]");
  });

  it("always redacts a hash hotline, even on a kennel with its own domain", () => {
    expect(redact("Hash hotline: 254-555-0142", "https://kennel.example.org")).toBe("Hash hotline: [phone]");
  });
});

describe("redactPersonalData — leaves non-personal text alone", () => {
  it.each([
    ["run number", "Run #2259 on trail"],
    ["hash-prefixed run range", "Missing #285-1200 from the archive"],
    ["run range", "Runs 650-1200 are missing"],
    ["trail range", "Trails 700-1500 are missing"],
    ["ISO date", "Date 2026-11-08 was wrong"],
    ["ISO timestamp", "at 2026-11-08T18:30:00Z"],
    ["US date", "on 11/08/2026"],
    ["dashed day-first date", "Effective 01-02-2026"],
    ["dotted day-first date", "Effective 01.02.2026"],
    ["year range", "Hare Line 2024-2026 page"],
    ["spaced year range", "footer 2019 - 2026"],
    ["contact word before a date", "cell 2026-11-08"],
    ["contact word before a year range", "text 2024-2026"],
    ["time", "starts 18:30"],
    ["time range", "6:30-7:30 PM"],
    ["ZIP+4", "Burlington, VT 05401-1234"],
    ["unix timestamp", "ts 1762617600"],
    ["cuid", "cmspg008m000k04jsyjv4usds"],
    ["cuid with long digit run", "cmqv1wx25455501hn1j1d11a1"],
    ["UUID", "550e8400-e29b-41d4-a716-446655440000"],
    ["UUID with a 3-4 digit run", "PublicKennelId 12345c67-c123-4567-b1c1-12fe12345678"],
    ["slug with a digit pair", "/events/run-286-2026"],
    ["hyphenated token", "nych3-555-0144"],
    ["9-digit Meetup id", "Meetup event 312345678"],
    ["15-digit Facebook id", "groups/100000123456789"],
    ["10-digit path id", "facebook.com/groups/5045550123"],
    ["Sheets gid", "tab (gid 2045550123): 41 rows"],
    ["migration id", "20261108123000_onboard_hc"],
    ["compact date", "DTSTART 20261108"],
    ["latitude and longitude", "(40.7128, -74.0060)"],
    ["long decimal coordinates", "40.7128123, -122.4194155"],
    ["three-digit longitude", "100.5018, 13.7563"],
    ["plus-one convention", "+1 510 Crew"],
    ["distance range", "+3-5 milers"],
    ["retina image name", "logo@2x.png"],
    ["npm package version", "next@16.0.0"],
    ["scoped package", "@types/node"],
    ["social handle URL path", "tiktok.com/@kennel"],
    ["shared calendar id", "abc123def456@group.calendar.google.com"],
    ["imported calendar id", "abc123def456@import.calendar.google.com"],
    ["holiday calendar id", "en.usa.holiday@group.v.calendar.google.com"],
    ["iCal event UID", "7q2k9d1mfp3vbt8xj4hn6cs0ag@google.com"],
    ["percent-encoded calendar id", "src=abc123def456%40group.calendar.google.com"],
  ])("leaves %s", (_label, text) => {
    expect(redact(text)).toBe(text);
  });

  it.each([
    ["Facebook event", "https://www.facebook.com/events/1234567890123456/"],
    ["Meetup event", "https://www.meetup.com/kennel/events/312345678/"],
    ["Calendar event", "https://www.google.com/calendar/event?eid=bXZ0NDJvcnVsZTJr"],
    ["path with a phone shape", "https://example.com/254-555-0142/page"],
    ["query with a bare 10-digit id", "https://example.com/p?id=5045550123"],
    ["scheme-less www", "www.example.com/555-0144"],
    ["Maps view", "https://www.google.com/maps/place/Pub/@40.7128,-74.0060,17z/data=!3m1!4b1!4m6"],
  ])("leaves a %s URL intact", (_label, url) => {
    expect(redact(`see ${url} for detail`)).toBe(`see ${url} for detail`);
  });

  it("still redacts a short address on google.com", () => {
    expect(redact("hare@google.com")).toBe("[email]");
  });

  it("leaves the audit-identity marker byte-identical", () => {
    const marker = emitIdentityMarker({
      stream: AUDIT_STREAM.CHROME_KENNEL,
      kennelCode: "h5-hi",
      ruleSlug: "hares-phone-truncation",
    });
    expect(redact(`Body text\n\n${marker}`)).toBe(`Body text\n\n${marker}`);
  });

  it("leaves a canonical block's hex digests alone", () => {
    const block = `<!-- audit-canonical: {"v":1,"kennelCode":"nych3","semanticHash":"2545550142aa","fingerprint":"5045550123bb"} -->`;
    expect(redact(block)).toBe(block);
  });
});

describe("redactPersonalData — phones hidden in contact URLs", () => {
  it.each([
    ["a wa.me number", "https://wa.me/12545550142", "https://wa.me/[phone]"],
    [
      "a phone query parameter",
      "https://api.whatsapp.com/send?phone=12545550142&text=hi",
      "https://api.whatsapp.com/send?phone=[phone]&text=hi",
    ],
    [
      "a percent-encoded phone query parameter",
      "https://api.whatsapp.com/send?phone=%2B12545550142",
      "https://api.whatsapp.com/send?phone=[phone]",
    ],
    ["a phone stuck to a URL by a comma", "https://example.com/a,254-555-0142", "https://example.com/a,[phone]"],
  ])("redacts %s and keeps the link", (_label, input, expected) => {
    expect(redact(input)).toBe(expected);
  });
});

describe("redactPersonalData — invariants", () => {
  it("is idempotent", () => {
    const once = redact("Whiff (254-555-0142), hare@example.com, call 555 0144");
    expect(redact(once)).toBe(once);
  });

  it("reports zero matches and returns identical text when clean", () => {
    const text = "Run #2259 on 2026-11-08 at the pub";
    expect(redactPersonalData(text)).toEqual({ text, redactions: 0 });
  });
});

describe("redactFinding", () => {
  it("redacts the title and body and totals the matches", () => {
    const result = redactFinding(
      { title: "Hare 254-555-0142 leaked", bodyMarkdown: "Reach hare@example.com or 254-555-0143" },
      null,
    );
    expect(result.title).toBe("Hare [phone] leaked");
    expect(result.bodyMarkdown).toBe("Reach [email] or [phone]");
    expect(result.redactions).toBe(3);
  });

  it("applies the kennel's own domain to both fields", () => {
    const result = redactFinding(
      { title: "gm@kennel.example.org is stale", bodyMarkdown: "Use gm@kennel.example.org" },
      "https://kennel.example.org",
    );
    expect(result.title).toBe("gm@kennel.example.org is stale");
    expect(result.bodyMarkdown).toBe("Use gm@kennel.example.org");
    expect(result.redactions).toBe(0);
  });
});
