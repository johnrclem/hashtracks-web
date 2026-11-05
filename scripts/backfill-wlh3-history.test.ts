import { describe, it, expect } from "vitest";
import { cleanWlh3Hares, loadWlh3History } from "./backfill-wlh3-history";

describe("cleanWlh3Hares", () => {
  it.each([
    ["Crap Nav P Trails from Hammersmith and Ravenscourt Park Tube", "Crap Nav"],
    ["Bhopal P Trail: From Ravenscourt Park Tube Map", "Bhopal"],
    ["Eric P Trial from Temple Tube Map", "Eric"],
    ["Funky Gibbon P- Trail from Kingsbury Tubes", "Funky Gibbon"],
    ["Rambo P=trail from Ealing Broadway", "Rambo"],
    ["Pickled Fart P – trail from Thames Ditton (main line)", "Pickled Fart"],
    ["Martian Matron & More On P-trails from Acton Central (overgr", "Martian Matron & More On"],
    ["The Mismanagement P Trail from Mortlake Mainline", "The Mismanagement"],
    ["Skylark This is Skylark’s Hatchday Trail and a drink stop is", "Skylark"],
    ["The Optimist There will be a trail of chalk P arrows from Ea", "The Optimist"],
    ["Sir Humpalot The trail will start from Barnes Bridge", "Sir Humpalot"],
    ["Castrato This weeks run starts at Hampstead tube", "Castrato"],
    ["Contour A tube strike is scheduled, so the", "Contour"],
    ["Robocop Murder trail starts from The Brew House", "Robocop"],
    ["Butt Plug & Pope Recovery-trail from YMCA sometime after bre", "Butt Plug & Pope"],
    ["Stayover “A” is the exit from Southwark Tube", "Stayover"],
    ["Eric Map", "Eric"],
    ["Bhopal Tube – Stamford Brook", "Bhopal"],
  ])("%j -> %j", (input, expected) => {
    expect(cleanWlh3Hares(input)).toBe(expected);
  });

  it("leaves clean hare names untouched", () => {
    expect(cleanWlh3Hares("Sx Toy and Headmistress")).toBe("Sx Toy and Headmistress");
    expect(cleanWlh3Hares("Mad Cow")).toBe("Mad Cow");
    expect(cleanWlh3Hares(undefined)).toBeUndefined();
  });
});

describe("loadWlh3History (frozen archive)", () => {
  const rows = loadWlh3History();

  it("keeps all 644 frozen rows", () => {
    expect(rows).toHaveLength(644);
  });

  it("has no direction/aside text left in any hares value", () => {
    const leaky = rows
      .map((r) => r.hares ?? "")
      .filter((h) => /\b(?:tube|trails?|trial|map|this is|there will)\b/i.test(h) || h.length > 60);
    expect(leaky).toEqual([]);
  });
});
