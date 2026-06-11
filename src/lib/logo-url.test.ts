import { checkLogoUrl } from "./logo-url";

describe("checkLogoUrl (#1414 shared logo-url rule)", () => {
  it("treats empty / whitespace as ok (cleared)", () => {
    expect(checkLogoUrl("")).toBe("ok");
    expect(checkLogoUrl("   ")).toBe("ok");
  });

  it("treats site-relative paths as ok", () => {
    expect(checkLogoUrl("/kennel-logos/qbk.png")).toBe("ok");
  });

  it("accepts https URLs", () => {
    expect(checkLogoUrl("https://example.com/logo.png")).toBe("ok");
  });

  it("flags http URLs as insecure (mixed content)", () => {
    expect(checkLogoUrl("http://example.com/logo.png")).toBe("insecure-http");
  });

  it("flags other schemes as non-https", () => {
    expect(checkLogoUrl("ftp://example.com/logo.png")).toBe("non-https");
    expect(checkLogoUrl("data:image/png;base64,AAAA")).toBe("non-https");
  });

  it("flags unparseable values", () => {
    expect(checkLogoUrl("not a url")).toBe("unparseable");
  });
});
