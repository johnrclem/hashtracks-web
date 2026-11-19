import { namesRun } from "./ConfirmedCard";

describe("namesRun", () => {
  it.each([
    ["London Hash Run #2832", 2832, true],
    ["London Hash Run #2832", 283, false],
    ["#1 and #10", 1, true],
    ["Run #10", 1, false],
    ["Run #283!", 283, true],
    ["No run number", 5, false],
  ])("%s names #%i: %s", (headline, n, expected) => {
    expect(namesRun(headline, n)).toBe(expected);
  });
});
