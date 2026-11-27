import { existsSync } from "node:fs";
import path from "node:path";

/**
 * A loading.tsx wraps its segment and everything below it in a Suspense
 * boundary, so the 200 status is sent before the page runs. A missing kennel,
 * event or region then answers 200 with the not-found UI: a soft 404 to
 * search engines. The list pages keep their skeletons inside `(index)` route
 * groups, which do not wrap the detail routes.
 */
const DETAIL_ROUTES = [
  "kennels/[slug]",
  "kennels/region/[slug]",
  "hareline/[eventId]",
];

const APP_DIR = path.join(__dirname);

describe("detail routes answer a real 404", () => {
  it.each(DETAIL_ROUTES)("no loading.tsx wraps /%s", (route) => {
    const segments = route.split("/");
    for (let depth = 0; depth <= segments.length; depth++) {
      const dir = path.join(APP_DIR, ...segments.slice(0, depth));
      expect(existsSync(path.join(dir, "loading.tsx")), `${dir}/loading.tsx`).toBe(false);
    }
  });

  it("list pages keep their loading skeletons in (index) groups", () => {
    expect(existsSync(path.join(APP_DIR, "kennels/(index)/loading.tsx"))).toBe(true);
    expect(existsSync(path.join(APP_DIR, "hareline/(index)/loading.tsx"))).toBe(true);
  });
});
