import { describe, it, expect } from "vitest";
import { parseBombayHashPage, parseTitle } from "./bombay-hash";

// Faithful slice of the bombayhash.org SSR home page. Each run is a Spectra
// "root container" whose heading sits one level deeper than the body paragraphs,
// and the date/time/venue are emoji-anchored segments jammed into run-together
// paragraph text (no whitespace between fields) exactly as the live site emits.
// Includes the PII rego line (#628 phone + payee) to prove it never leaks, the
// "???" placeholder hares (#631), a special anniversary price (#630 ₹2100), and
// a drifted numbered heading (#999) with no parseable date to prove per-run
// fail-loud.
const FIXTURE = `
<div class="entry-content clear">
  <div class="spectra-is-root-container alignfull">
    <div class="wp-block-spectra-container">
      <h3><span>🍻🏃‍♂️🏃‍♀️ MUMBAI HASH HOUSE HARRIERS 🏃‍♀️🏃‍♂️🍻🐾 RUN #631 🐾</span></h3>
    </div>
    <p class="has-text-color">“No One Gets Left Behind… Unless You’re the Hare!” 😂🐇📅 Date: Sunday, 28th June 2026🕘 Time: 9:30 AM Sharp (Hash Time… 😜)📍 Venue: Shivaji Park Gymkhana</p>
    <p>🐇 HARES: ???🤔 Looking for brave volunteers… 🤪🍺💰 REGO: ✅ INR 250 till Friday, 26th June❌ Procrastinators Pay: INR 400 after that! 💸😂</p>
  </div>
  <div class="spectra-is-root-container alignfull">
    <div class="wp-block-spectra-container">
      <h3><span>🏃‍♂️🔥 BOMBAY HASH HOUSE HARRIERS 🔥🏃‍♀️🎉🍻 RUN #630 🍻🎉</span></h3>
    </div>
    <p class="has-text-color">⚠️ THIS IS NOT JUST ANOTHER RUN ⚠️📅 DATE: Sunday, 31st May 2026🕘 TIME: 9:30 AM📍 VENUE:🍻 SOCIAL – NESCO Gate 3, Goregaon East🕤 details🥃 REGO: ₹2100 🥃Completed 5 Trails since January 2026? Your rego is ONLY ₹1600</p>
  </div>
  <div class="spectra-is-root-container alignfull">
    <div class="wp-block-spectra-container">
      <h3><span>🐾🍺 BOMBAY HASH HOUSE HARRIERS 🍺🐾 BH3 RUN #629</span></h3>
    </div>
    <p class="has-text-color">🔥 THE MADHNESS MAYHEM RUN 🔥✅ Attendance is STRONGLY ENCOURAGED❌ Excuses are COMPLETE NONSENSE 😈 You will still say “mast tha!” after 😜🔥 Rao Bungalow Madh Marve Road Opp. Almeida Picnic Cottage 📅 Sunday, 26th April 2026⏰ 9:30 AM sharp</p>
  </div>
  <div class="spectra-is-root-container alignfull">
    <div class="wp-block-spectra-container">
      <h2><span>🚨 BOMBAY HASH RUN #628 🚨</span></h2>
    </div>
    <p class="has-text-color">Oi you filthy, beer-loving legends 🍻 this time we invade Malad ka concrete jungle 🌆 expect running like confused chickens and getting hopelessly lost</p>
    <p>📅 Sunday, 29 March 2026⏰ Assembly: 09:30 AM sharp-ish (Hash time 😏)📍 Pop Tate’s, Malad West💰 Damage: ₹250 per drunk runner 🍻📲 Pay via GPay/Paytm: 9320031565 (Shailesh Shah)⚠️ Register BEFORE Friday (27th)</p>
  </div>
  <div class="spectra-is-root-container alignfull">
    <div class="wp-block-spectra-container">
      <h3><span>🐾 BH3 RUN #999 🐾</span></h3>
    </div>
    <p>Date and venue coming soon! Stay tuned for the next madness. 🍺🐾</p>
  </div>
</div>
`;

describe("parseBombayHashPage", () => {
  const result = parseBombayHashPage(FIXTURE);
  const byRun = new Map(result.events.map((e) => [e.runNumber, e]));

  it("parses every run block keyed on heading text, not tag level", () => {
    expect(result.blockCount).toBe(5); // 4 dated runs + 1 drift heading
    expect(result.events.map((e) => e.runNumber).sort((a, b) => Number(a) - Number(b))).toEqual([
      628, 629, 630, 631,
    ]);
  });

  it("extracts year-bearing dates as UTC-noon YYYY-MM-DD (no inference)", () => {
    expect(byRun.get(631)?.date).toBe("2026-06-28");
    expect(byRun.get(630)?.date).toBe("2026-05-31");
    expect(byRun.get(629)?.date).toBe("2026-04-26");
    expect(byRun.get(628)?.date).toBe("2026-03-29"); // weekday-prefixed, "29 March 2026"
  });

  it("normalizes the assembly time to 24-hour HH:MM across marker variants", () => {
    expect(byRun.get(631)?.startTime).toBe("09:30"); // 🕘 Time:
    expect(byRun.get(628)?.startTime).toBe("09:30"); // ⏰ Assembly:
  });

  it("tags every event with the kennel code", () => {
    for (const e of result.events) {
      expect(e.kennelTags).toEqual(["bombay-h3"]);
    }
  });

  it("extracts the run headline as the title, dropping emoji/CTA/prose (#2421/#2425)", () => {
    expect(byRun.get(629)?.title).toBe("THE MADHNESS MAYHEM RUN");
    expect(byRun.get(630)?.title).toBe("THIS IS NOT JUST ANOTHER RUN"); // ⚠ wrappers stripped
    expect(byRun.get(631)?.title).toBe("No One Gets Left Behind… Unless You’re the Hare!");
    // #628 leads with prose (no clean headline) → undefined so merge synthesizes
    // "Bombay H3 Trail #628".
    expect(byRun.get(628)?.title).toBeUndefined();
  });

  it("extracts the venue and strips a 🍻-prefixed/labeled value", () => {
    expect(byRun.get(631)?.location).toBe("Shivaji Park Gymkhana");
    expect(byRun.get(628)?.location).toBe("Pop Tate’s, Malad West");
    expect(byRun.get(630)?.location).toContain("NESCO Gate 3"); // leading 🍻 stripped
  });

  it("recovers the venue from text before 📅 when the 📍 marker is absent (#2422)", () => {
    // Run #629 has no 📍 — the venue sits before the date marker.
    expect(byRun.get(629)?.location).toBe("Rao Bungalow Madh Marve Road Opp. Almeida Picnic Cottage");
  });

  it("clears placeholder hares (label present) but preserves absent ones", () => {
    expect(byRun.get(631)?.hares).toBeNull(); // "HARES: ???" → label seen → explicit clear
    expect(byRun.get(630)?.hares).toBeUndefined(); // no HARES label → preserve existing
    expect(byRun.get(628)?.hares).toBeUndefined(); // no HARES label → preserve existing
  });

  it("emits a special per-event cost only when it exceeds the standard fee", () => {
    expect(byRun.get(630)?.cost).toBe("₹2100"); // anniversary price
    expect(byRun.get(631)?.cost).toBeUndefined(); // standard ₹250/₹400 → default
    expect(byRun.get(628)?.cost).toBeUndefined();
  });

  it("never leaks PII (phone numbers / payee names) into any field", () => {
    const blob = JSON.stringify(result.events);
    expect(blob).not.toContain("9320031565");
    expect(blob).not.toContain("Shailesh");
  });

  it("fails loud per-run on a numbered heading whose date cannot be parsed", () => {
    expect(byRun.has(999)).toBe(false);
    const drift = result.parseErrors.find((p) => /#999/.test(p.error));
    expect(drift).toBeDefined();
    expect(drift?.field).toBe("date");
  });
});

describe("parseTitle", () => {
  it("returns the clean headline before a CTA emoji", () => {
    expect(parseTitle("🔥 THE MADHNESS MAYHEM RUN 🔥✅ Attendance is STRONGLY ENCOURAGED")).toBe(
      "THE MADHNESS MAYHEM RUN",
    );
  });

  it("returns undefined when the terminator is at index 0 (paragraph is pure CTA)", () => {
    // Prior to the fix (term.index > 0), this returned the full string instead
    // of slicing to 0 → an empty string that correctly falls through to undefined.
    expect(parseTitle("✅ Attendance / ❌ Excuses")).toBeUndefined();
    expect(parseTitle("📅 Date: Sunday, 28th June 2026")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(parseTitle(undefined)).toBeUndefined();
  });

  it("strips ⚠ emoji wrappers without treating ⚠ as a terminator", () => {
    expect(parseTitle("⚠️ THIS IS NOT JUST ANOTHER RUN ⚠️📅 DATE: Sunday")).toBe(
      "THIS IS NOT JUST ANOTHER RUN",
    );
  });

  it("returns undefined for a too-short or placeholder result", () => {
    expect(parseTitle("AB")).toBeUndefined();
    expect(parseTitle("TBA")).toBeUndefined();
  });
});
