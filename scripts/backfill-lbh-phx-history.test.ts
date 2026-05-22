import { describe, it, expect } from "vitest";
import {
  parseCalendarPage,
  parseDetailPage,
  pickCanonicalSighting,
} from "./backfill-lbh-phx-history";

const CAL_HTML = `<html><body><table>
  <tr>
    <td><a href="https://www.phoenixhhh.org/?event=lbh-628-reverse-austrailian-jort-day" title="LBH #628: Reverse AusTRAILian Jort Day!">26</a></td>
    <td><a href="https://www.phoenixhhh.org/?event=lbh-629-pulaski-day" title="LBH #629: Pulaski Day!">4</a></td>
    <td><a href="https://www.phoenixhhh.org/?event=lbh-630-reach-into-my-magic-sack" title="LBH #630: Reach into My Magic Sack">11</a></td>
    <td><a href="https://www.phoenixhhh.org/?event=lbh-628-reverse-austrailian-jort-day" title="LBH #628: Reverse AusTRAILian Jort Day!">More Info</a></td>
    <td><a href="https://www.phoenixhhh.org/?event=hump-d-hash-5-6-taco-bell-cantina" title="Hump D Hash – 5/6 – Taco Bell Cantina">6</a></td>
    <td><a href="https://www.phoenixhhh.org/?event=lbh-special-event" title="Lost Boobs Special">15</a></td>
  </tr>
</table></body></html>`;

const DETAIL_HTML = `<html><body>
<article>
<div class="entry-content">
  <p>Map Unavailable Date/Time Date(s) - Monday - 05/25/20266:30 pm - 9:30 pm Location Backyards Categories No Categories</p>
  <p>Join us for the 745th running of the Lost Boobs Hash House Harriers!!!</p>
  <p>Hare(s): Sir Public Display of Erection-ski</p>
  <p>Who: People that are at least 21 years old (no exceptions).</p>
  <p>What: A 3ish mile (true trail) Hash. Walker/runner friendly.A to A.</p>
  <p>Where: Backyards. 9261 East Via de Ventura, Scottsdale, AZ 85258</p>
  <p>Why: Monday is a hashing day.</p>
  <p>When: Monday, 5/25/2026 Meet at 6pmHares away at 6:40 PM.Chalk talk at 6:45 PM.Walkers away around 7pm.</p>
  <p>Hash Cash: $5 cash unless you're a virgin. Please arrive on time so that you can check in.</p>
  <p>Bring: A whistle, head(!)lamp, trail chalk, a vessel, low expectations.</p>
</div>
</article>
</body></html>`;

describe("parseCalendarPage", () => {
  it("extracts LBH anchors with runNumber + day + title + slug", () => {
    const sightings = parseCalendarPage(CAL_HTML, 2024, 3);
    expect(sightings).toHaveLength(3);
    expect(sightings.map((s) => s.runNumber).sort((a, b) => a - b)).toEqual([628, 629, 630]);
    const s628 = sightings.find((s) => s.runNumber === 628)!;
    expect(s628.day).toBe(26);
    expect(s628.yr).toBe(2024);
    expect(s628.mo).toBe(3);
    expect(s628.slug).toBe("lbh-628-reverse-austrailian-jort-day");
  });

  it("ignores 'More Info' duplicate anchors (text isn't a day number)", () => {
    const sightings = parseCalendarPage(CAL_HTML, 2024, 3);
    // The "More Info" anchor with the same lbh-628 slug should not produce
    // a second sighting for the same slug.
    const slug628 = sightings.filter((s) => s.slug === "lbh-628-reverse-austrailian-jort-day");
    expect(slug628).toHaveLength(1);
  });

  it("ignores non-LBH anchors (Hump D Hash) and LBH anchors without a #N title", () => {
    const sightings = parseCalendarPage(CAL_HTML, 2024, 3);
    const slugs = sightings.map((s) => s.slug);
    expect(slugs).not.toContain("hump-d-hash-5-6-taco-bell-cantina");
    expect(slugs).not.toContain("lbh-special-event");
  });

  it("strips the LBH #N prefix from the title field", () => {
    const sightings = parseCalendarPage(CAL_HTML, 2024, 3);
    const s629 = sightings.find((s) => s.runNumber === 629);
    expect(s629?.title).toBe("Pulaski Day!");
  });
});

describe("pickCanonicalSighting", () => {
  it("returns the single sighting when only one exists", () => {
    const result = pickCanonicalSighting([
      { slug: "x", runNumber: 1, title: "x", day: 15, yr: 2024, mo: 3 },
    ]);
    expect(result).toEqual({ slug: "x", runNumber: 1, title: "x", day: 15, yr: 2024, mo: 3 });
  });

  it("prefers a middle-of-month sighting (day 8-21)", () => {
    const result = pickCanonicalSighting([
      { slug: "x", runNumber: 1, title: "x", day: 11, yr: 2024, mo: 3 },
      { slug: "x", runNumber: 1, title: "x", day: 11, yr: 2024, mo: 4 },
    ]);
    expect(result.mo).toBe(3);
  });

  it("prefers the LATER month when day <= 7 (next-month-leading spillover)", () => {
    const result = pickCanonicalSighting([
      { slug: "x", runNumber: 1, title: "x", day: 1, yr: 2024, mo: 3 },
      { slug: "x", runNumber: 1, title: "x", day: 1, yr: 2024, mo: 4 },
    ]);
    expect(result.mo).toBe(4);
  });

  it("prefers the EARLIER month when day >= 22 (previous-month-trailing spillover)", () => {
    const result = pickCanonicalSighting([
      { slug: "x", runNumber: 1, title: "x", day: 26, yr: 2024, mo: 2 },
      { slug: "x", runNumber: 1, title: "x", day: 26, yr: 2024, mo: 3 },
    ]);
    expect(result.mo).toBe(2);
  });
});

describe("parseDetailPage", () => {
  it("extracts startTime, hares, location, cost from a representative LBH detail page", () => {
    const result = parseDetailPage(DETAIL_HTML);
    expect(result.startTime).toBe("18:30");
    expect(result.hares).toBe("Sir Public Display of Erection-ski");
    expect(result.location).toBe("Backyards. 9261 East Via de Ventura, Scottsdale, AZ 85258");
    expect(result.cost).toBe("$5 cash unless you're a virgin");
  });

  it("returns undefined for fields when regexes miss (preserve-existing semantics)", () => {
    const result = parseDetailPage("<html><body><div class='entry-content'>No structured fields here.</div></body></html>");
    expect(result.startTime).toBeUndefined();
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.cost).toBeUndefined();
  });
});
