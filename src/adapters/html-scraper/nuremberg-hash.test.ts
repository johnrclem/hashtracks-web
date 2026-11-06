import { readFileSync } from "node:fs";
import path from "node:path";
import { parseNurembergDate, parseNurembergPage, splitHares } from "./nuremberg-hash";

// The live /run-info/ `content.rendered` from WP REST (2026-11-05).
const RENDERED = readFileSync(path.join(__dirname, "fixtures/nuremberg-hash-run-info-2026-11-05.html.fixture"), "utf-8");

describe("parseNurembergDate", () => {
  it.each([
    ["Saturday 10th October 2026", "2026-10-10"],
    ["Saturday 31th October 2026", "2026-10-31"],
    ["January 17th, 2026 (Saturday)", "2026-01-17"],
    ["July 11th 2026 (Saturday)", "2026-07-11"],
    ["July 25-27th 2025 (Friday-Sunday)", "2025-07-25"],
    ["December 19+20th 2025 (Saturday)", "2025-12-19"],
  ])("%s → %s", (input, expected) => {
    expect(parseNurembergDate(input)).toBe(expected);
  });
  it("rejects month-only rows", () => {
    expect(parseNurembergDate("January")).toBeNull();
  });
});

describe("splitHares", () => {
  it("splits on + and &", () => {
    expect(splitHares("Squeeze It + MFT")).toBe("MFT, Squeeze It");
    expect(splitHares("TBA")).toBeUndefined();
  });
});

describe("parseNurembergPage", () => {
  const { events } = parseNurembergPage(RENDERED);
  const on = (date: string) => events.find((e) => e.date === date);

  it("uses the detail block for the next run", () => {
    expect(on("2026-10-10")).toMatchObject({
      kennelTags: ["nh3-de"],
      runNumber: 102,
      title: "The double Hare r*n (co-r*n with Munich MH3)",
      hares: "MFT, Squeeze It",
      startTime: "14:00",
      location: "Ingolstadt",
      locationUrl: "https://maps.app.goo.gl/cymtinofEcmof1tSA",
    });
  });

  it("keeps a TBA maps link out of locationUrl", () => {
    expect(on("2026-10-31")).toMatchObject({ runNumber: 103, title: "Halloween r*n", location: "Nürnberg", locationUrl: undefined });
  });

  it("adds hareline-only rows and skips cancelled ones", () => {
    expect(on("2026-12-12")).toMatchObject({ title: "X-mas r*n", location: "Nürnberg", hares: undefined });
    expect(on("2026-12-12")?.runNumber).toBeUndefined();
    expect(on("2026-11-28")).toMatchObject({ location: undefined, hares: undefined });
    expect(on("2026-01-17")).toBeUndefined();
  });

  it("lets a detail block replace a nearby weekend hareline row", () => {
    expect(on("2025-12-19")).toBeUndefined();
    expect(on("2025-12-20")?.runNumber).toBe(91);
  });

  it("emits one event per date", () => {
    expect(new Set(events.map((e) => e.date)).size).toBe(events.length);
  });
});
