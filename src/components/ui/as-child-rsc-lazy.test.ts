import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { Button } from "./button";
import { Tooltip, TooltipProvider, TooltipTrigger } from "./tooltip";

// Contract: `asChild` must render a child that a Server Component hands over as
// an RSC lazy reference (what `next dev` SSR does). @radix-ui/react-slot < 1.2.4
// rendered null for these, causing hydration mismatches; radix-ui >= 1.5.0 is
// required.

// The shape Flight's createLazyChunkWrapper produces for a resolved chunk.
// `then` is required: Slot only unwraps a lazy whose _payload is promise-like.
function rscLazy(element: ReactElement): ReactNode {
  const chunk = {
    status: "fulfilled",
    value: element,
    then(resolve: (value: ReactElement) => void) {
      resolve(element);
    },
  };
  return {
    $$typeof: Symbol.for("react.lazy"),
    _payload: chunk,
    _init: (payload: typeof chunk) => payload.value,
  } as unknown as ReactNode;
}

describe("asChild with an RSC lazy child", () => {
  it("TooltipTrigger renders the region badge span", () => {
    const badge = createElement(
      "span",
      { "aria-label": "Region: St. Louis, MO", role: "img" },
      "STL",
    );
    const html = renderToString(
      createElement(
        TooltipProvider,
        null,
        createElement(
          Tooltip,
          null,
          createElement(TooltipTrigger, { asChild: true }, rscLazy(badge)),
        ),
      ),
    );
    expect(html).toContain('aria-label="Region: St. Louis, MO"');
    expect(html).toContain('data-slot="tooltip-trigger"');
    expect(html).toContain(">STL</span>");
  });

  it("Button renders the link it wraps", () => {
    const link = createElement("a", { href: "/hareline" }, "Hareline");
    const html = renderToString(
      createElement(Button, { asChild: true }, rscLazy(link)),
    );
    expect(html).toContain('href="/hareline"');
    expect(html).toContain('data-slot="button"');
  });
});
