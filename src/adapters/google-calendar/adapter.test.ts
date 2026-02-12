import { describe, it, expect } from "vitest";
import {
  extractKennelTag,
  extractRunNumber,
  extractTitle,
  extractHares,
} from "./adapter";

// ── extractKennelTag ──

describe("extractKennelTag", () => {
  it("matches Boston Ball Buster", () => {
    expect(extractKennelTag("Boston Ball Buster #123")).toBe("BoBBH3");
  });

  it("matches BoBBH3 abbreviation", () => {
    expect(extractKennelTag("BoBBH3: Run Name")).toBe("BoBBH3");
  });

  it("matches Beantown", () => {
    expect(extractKennelTag("Beantown #255: Taste of Spring")).toBe("Beantown");
  });

  it("matches Pink Taco", () => {
    expect(extractKennelTag("Pink Taco: Ladies Night")).toBe("Pink Taco");
  });

  it("matches PT2H3 → Pink Taco", () => {
    expect(extractKennelTag("PT2H3: Run")).toBe("Pink Taco");
  });

  it("matches Boston Moon", () => {
    expect(extractKennelTag("Boston Moon: Full Moon Run")).toBe("Bos Moon");
  });

  it("matches Moon keyword", () => {
    expect(extractKennelTag("Full Moon Hash")).toBe("Bos Moon");
  });

  it("matches BoH3", () => {
    expect(extractKennelTag("BoH3: Weekly Run")).toBe("BoH3");
  });

  it("matches BH3", () => {
    expect(extractKennelTag("BH3: Something")).toBe("BoH3");
  });

  it("matches B3H4 → BoBBH3", () => {
    expect(extractKennelTag("B3H4 Run")).toBe("BoBBH3");
  });

  it("falls back to BoH3 for unknown", () => {
    expect(extractKennelTag("Unknown Event Name")).toBe("BoH3");
  });
});

// ── extractRunNumber ──

describe("extractRunNumber", () => {
  it("extracts from summary #N", () => {
    expect(extractRunNumber("Beantown #255: Trail")).toBe(255);
  });

  it("extracts BH3 #N from description", () => {
    expect(extractRunNumber("Weekly Run", "BH3 #2784\nDetails")).toBe(2784);
  });

  it("extracts standalone #N from description", () => {
    expect(extractRunNumber("Weekly Run", "Details\n#2792\nMore")).toBe(2792);
  });

  it("returns undefined with no match", () => {
    expect(extractRunNumber("No Number", "No number here")).toBeUndefined();
  });

  it("returns undefined with no description", () => {
    expect(extractRunNumber("No Number Here")).toBeUndefined();
  });
});

// ── extractTitle ──

describe("extractTitle", () => {
  it("strips kennel prefix", () => {
    expect(extractTitle("Beantown #255: The Trail Name")).toBe("The Trail Name");
  });

  it("strips BoH3 prefix", () => {
    expect(extractTitle("BoH3: Run Name")).toBe("Run Name");
  });

  it("returns full summary when no colon", () => {
    expect(extractTitle("No Prefix Event")).toBe("No Prefix Event");
  });
});

// ── extractHares ──

describe("extractHares", () => {
  it("extracts from Hare: line", () => {
    expect(extractHares("Details\nHare: Mudflap\nON-IN: Some Bar")).toBe("Mudflap");
  });

  it("extracts from Hares: line", () => {
    expect(extractHares("Hares: Alice & Bob")).toBe("Alice & Bob");
  });

  it("extracts from Who: line", () => {
    expect(extractHares("Who: Charlie")).toBe("Charlie");
  });

  it("skips generic Who: answers", () => {
    expect(extractHares("Who: that be you")).toBeUndefined();
  });

  it("skips 'everyone'", () => {
    expect(extractHares("Who: everyone")).toBeUndefined();
  });

  it("returns undefined when no match", () => {
    expect(extractHares("No hare info here")).toBeUndefined();
  });

  it("takes only first line of hare text", () => {
    expect(extractHares("Hare: Alice\nSome other info")).toBe("Alice");
  });
});
