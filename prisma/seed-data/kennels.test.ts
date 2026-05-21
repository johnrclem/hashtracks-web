import { KENNELS } from "./kennels";

describe("KENNELS seed data — Ipoh H3 profile (#1478)", () => {
  const ipoh = KENNELS.find((k) => k.kennelCode === "ipoh-h3");

  // #1477 fixed the source RRULE to Monday@18:00; #1478 ships the kennel-level
  // display strings + new profile fields so the kennel card / schedule sub-
  // headline + description / logo / contact / lineage all converge. Lock the
  // values so a future cut-and-paste from JB / Penang neighbors can't
  // silently regress Ipoh back to Saturday/17:00.
  it("Ipoh H3 row is present", () => {
    expect(ipoh).toBeDefined();
  });

  it("schedule strings match the post-#1477 Monday@6:00 PM cadence", () => {
    expect(ipoh?.scheduleDayOfWeek).toBe("Monday");
    expect(ipoh?.scheduleTime).toBe("6:00 PM");
    expect(ipoh?.scheduleFrequency).toBe("Weekly");
  });

  it("description avoids internal jargon (#1437 / #1478)", () => {
    // The pre-#1478 prose leaked "STATIC_SCHEDULE", "exception", "scrapeable",
    // and the directory-verification reasoning into the user-facing card.
    expect(ipoh?.description).toBeDefined();
    expect(ipoh!.description).not.toMatch(/STATIC_SCHEDULE/i);
    expect(ipoh!.description).not.toMatch(/scrapeable/i);
    expect(ipoh!.description).not.toMatch(/\bexception\b/i);
    // Block the specific stale wrong-day cadence patterns rather than the
    // bare word — a future "annual Saturday campout" line should still pass.
    expect(ipoh!.description).not.toMatch(/\bsaturday\s+(?:runs?|trails?|evening|cadence)\b/i);
  });

  it("ships the new optional profile fields", () => {
    expect(ipoh?.logoUrl).toBe("/kennel-logos/ipoh-h3.jpg");
    expect(ipoh?.contactEmail).toBe("ipohhhh@yahoo.com");
    expect(ipoh?.founder).toBe("David R. 'Mad Dog' Denning");
    expect(ipoh?.parentKennelCode).toBe("motherh3");
  });

  it("parentKennelCode resolves to a real kennel in seed data", () => {
    const parent = KENNELS.find((k) => k.kennelCode === ipoh?.parentKennelCode);
    expect(parent).toBeDefined();
    // Kuala Lumpur Hash House Harriers = Mother Hash (1938), the founding
    // chapter of the entire hash movement.
    expect(parent?.fullName).toMatch(/Kuala Lumpur/i);
  });
});
