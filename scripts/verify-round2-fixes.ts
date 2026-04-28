/**
 * Live verification for Round 2 fixes (issues #796–#802).
 * Runs each affected adapter against its production URL and asserts the
 * previously-reported defect is gone in the sample events.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { getAdapter } from "../src/adapters/registry";
import type { RawEventData } from "../src/adapters/types";

type Event = RawEventData;

async function runOne(
  sourceName: string,
  days = 180,
  configOverride?: (cfg: Record<string, unknown>) => Record<string, unknown>,
): Promise<{ events: Event[]; errors: string[] }> {
  const source = await prisma.source.findFirst({ where: { name: sourceName } });
  if (!source) throw new Error(`source not found: ${sourceName}`);
  const patched = configOverride
    ? { ...source, config: configOverride((source.config ?? {}) as Record<string, unknown>) as never }
    : source;
  const adapter = getAdapter(
    source.type,
    patched.url ?? undefined,
    (patched.config ?? undefined) as Record<string, unknown> | undefined,
  );
  const result = await adapter.fetch(patched, { days });
  return { events: result.events, errors: result.errors };
}

let hasFailures = false;

function print(label: string, pass: boolean, detail: string) {
  hasFailures ||= !pass;
  const icon = pass ? "OK" : "FAIL";
  console.log(`[${icon}] ${label} — ${detail}`);
}

async function main() {
  // #799 Pedal Files — no trailing "- tbd"/" -" in titles
  {
    const { events } = await runOne("Pedal Files Bash Google Calendar");
    const bad = events.filter(e => e.title && /\s[-–—]\s*(?:tbd|tba|tbc)?\s*$/i.test(e.title));
    print("#799 Pedal Files trailing-dash titles", bad.length === 0,
      `events=${events.length} bad=${bad.length} ${bad.slice(0, 3).map(e => e.title).join(" | ")}`);
  }

  // #796 Whoreman (Wasatch) — titles no longer "wasatch #N".
  // Seed adds `defaultTitles.wasatch-h3`; inject it here so we can verify
  // the adapter logic against live calendar data pre-seed-deploy.
  {
    const { events } = await runOne(
      "Whoreman H3 Calendar",
      180,
      cfg => ({ ...cfg, defaultTitles: { ...(cfg.defaultTitles as Record<string, string> | undefined), "wasatch-h3": "Wasatch H3 Trail" } }),
    );
    const wasatch = events.filter(e => e.kennelTags[0] === "wasatch-h3");
    const bad = wasatch.filter(e => /^wasatch\s*#?\d+$/i.test(e.title ?? ""));
    const healed = wasatch.filter(e => /^Wasatch H3 Trail #\d+$/.test(e.title ?? ""));
    print("#796 Wasatch bare-code titles", bad.length === 0 && healed.length > 0,
      `wasatch=${wasatch.length} bad=${bad.length} healed=${healed.length} sample=${wasatch.slice(0, 3).map(e => e.title).join(" | ")}`);
  }

  // #800 Dayton DH4 — titles no longer "DH3 #N". Seed adds `defaultTitle`;
  // inject for live verify pre-seed-deploy.
  {
    const { events } = await runOne(
      "DH4 Google Calendar",
      180,
      cfg => ({ ...cfg, defaultTitle: "Dayton H4 Trail" }),
    );
    const bad = events.filter(e => /^dh3\s*#?\d+$/i.test(e.title ?? ""));
    const healed = events.filter(e => /^Dayton H4 Trail #\d+$/.test(e.title ?? ""));
    print("#800 Dayton DH3-prefix titles", bad.length === 0 && healed.length > 0,
      `events=${events.length} bad=${bad.length} healed=${healed.length} sample=${events.slice(0, 5).map(e => e.title).join(" | ")}`);
  }

  // #798 ABQ — no email-CTA locations
  {
    const { events } = await runOne("ABQ H3 Google Calendar");
    const bad = events.filter(e => e.location && (/inquire.*@/i.test(e.location) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.location.trim())));
    print("#798 ABQ email-CTA locations", bad.length === 0,
      `events=${events.length} bad=${bad.length} sample-locs=${events.filter(e => e.location).slice(0, 3).map(e => e.location).join(" | ")}`);
  }

  // #801 Reading H3 — at least some events now have locations extracted
  {
    const { events } = await runOne("Reading H3 Localendar");
    const withLoc = events.filter(e => e.location);
    print("#801 Reading H3 location fill", withLoc.length > 0,
      `events=${events.length} with-location=${withLoc.length} sample=${withLoc.slice(0, 3).map(e => e.location).join(" | ")}`);
  }

  // #797 Hockessin — title is "Hockessin H3 Trail #N", hares populated separately
  {
    const { events } = await runOne("Hockessin H3 Website");
    const malformed = events.filter(e => !e.title || !/^Hockessin H3 Trail #\d+$/.test(e.title));
    const withHares = events.filter(e => e.hares);
    const sample = events.slice(0, 3).map(e => `${e.title} / hares=${e.hares ?? "—"}`).join(" | ");
    print("#797 Hockessin title normalization", malformed.length === 0,
      `events=${events.length} malformed=${malformed.length} with-hares=${withHares.length} sample=${sample}`);
  }

  // #802 Bangkok Full Moon — Hares field does not contain "On On" boilerplate
  {
    const { events } = await runOne("Bangkok Full Moon Hash");
    const bad = events.filter(e => e.hares && /^\s*on\s+on\b/i.test(e.hares));
    print("#802 BFMH3 'On On' in hares", bad.length === 0,
      `events=${events.length} bad=${bad.length} sample-hares=${events.filter(e => e.hares).slice(0, 3).map(e => e.hares).join(" | ")}`);
  }

  await prisma.$disconnect();
  if (hasFailures) process.exit(1);
}

main().catch(async err => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
