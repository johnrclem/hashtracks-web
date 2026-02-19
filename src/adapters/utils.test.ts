import {
  MONTHS,
  MONTHS_ZERO,
  parse12HourTime,
  googleMapsSearchUrl,
  extractUkPostcode,
  validateSourceConfig,
} from "./utils";

describe("MONTHS", () => {
  it("maps abbreviated month names to 1-indexed numbers", () => {
    expect(MONTHS.jan).toBe(1);
    expect(MONTHS.dec).toBe(12);
    expect(MONTHS.june).toBe(6);
  });
});

describe("MONTHS_ZERO", () => {
  it("maps abbreviated month names to 0-indexed numbers", () => {
    expect(MONTHS_ZERO.jan).toBe(0);
    expect(MONTHS_ZERO.december).toBe(11);
    expect(MONTHS_ZERO.june).toBe(5);
  });
});

describe("parse12HourTime", () => {
  it("parses PM time", () => {
    expect(parse12HourTime("7:00 PM")).toBe("19:00");
  });

  it("parses AM time", () => {
    expect(parse12HourTime("9:30 am")).toBe("09:30");
  });

  it("handles 12 PM (noon)", () => {
    expect(parse12HourTime("12:00 pm")).toBe("12:00");
  });

  it("handles 12 AM (midnight)", () => {
    expect(parse12HourTime("12:00 am")).toBe("00:00");
  });

  it("returns undefined for no match", () => {
    expect(parse12HourTime("no time here")).toBeUndefined();
  });

  it("extracts time from surrounding text", () => {
    expect(parse12HourTime("7:00 PM gather at the pub")).toBe("19:00");
  });
});

describe("googleMapsSearchUrl", () => {
  it("generates a Google Maps search URL", () => {
    expect(googleMapsSearchUrl("Central Park")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Central%20Park",
    );
  });

  it("encodes special characters", () => {
    const url = googleMapsSearchUrl("123 Main St, NYC");
    expect(url).toContain("123%20Main%20St%2C%20NYC");
  });
});

describe("extractUkPostcode", () => {
  it("extracts a UK postcode", () => {
    expect(extractUkPostcode("The Dolphin, SE11 5JA")).toBe("SE11 5JA");
  });

  it("extracts postcode without space", () => {
    expect(extractUkPostcode("SW182SS area")).toBe("SW182SS");
  });

  it("returns null when no postcode found", () => {
    expect(extractUkPostcode("no postcode here")).toBeNull();
  });
});

describe("validateSourceConfig", () => {
  it("validates a valid config object", () => {
    const config = validateSourceConfig<{ sheetId: string }>(
      { sheetId: "abc123" }, "TestAdapter", { sheetId: "string" },
    );
    expect(config.sheetId).toBe("abc123");
  });

  it("throws for null config", () => {
    expect(() => validateSourceConfig(null, "TestAdapter", { sheetId: "string" }))
      .toThrow("source.config is null");
  });

  it("throws for missing required field", () => {
    expect(() => validateSourceConfig({ foo: "bar" }, "TestAdapter", { sheetId: "string" }))
      .toThrow('missing required config field "sheetId"');
  });

  it("throws for wrong type", () => {
    expect(() => validateSourceConfig({ sheetId: 123 }, "TestAdapter", { sheetId: "string" }))
      .toThrow("config.sheetId must be a string");
  });

  it("validates array fields", () => {
    const config = validateSourceConfig<{ slugs: string[] }>(
      { slugs: ["a", "b"] }, "TestAdapter", { slugs: "array" },
    );
    expect(config.slugs).toEqual(["a", "b"]);
  });

  it("throws for non-array when array expected", () => {
    expect(() => validateSourceConfig({ slugs: "not-array" }, "TestAdapter", { slugs: "array" }))
      .toThrow("config.slugs must be an array");
  });
});
