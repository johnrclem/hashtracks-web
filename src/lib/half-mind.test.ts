import { halfMindListingUrl } from "./half-mind";

describe("halfMindListingUrl", () => {
  it("builds the listing URL", () => {
    expect(halfMindListingUrl("19")).toBe("https://half-mind.com/regionalwebsite/p_list1.php?ID=19");
  });
  it("URL-encodes the id", () => {
    expect(halfMindListingUrl("1&x=2 3")).toBe(
      "https://half-mind.com/regionalwebsite/p_list1.php?ID=1%26x%3D2%203",
    );
  });
});
