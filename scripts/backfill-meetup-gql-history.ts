/**
 * One-shot history backfill for a MEETUP source via Meetup's public GraphQL
 * endpoint (`POST https://www.meetup.com/gql2`).
 *
 * The live adapter reads the logged-out events pages, which carry the upcoming
 * runs plus only the ~10 most recent past ones, so deep history never arrives.
 * Logged out, `groupByUrlname.events(status: PAST)` pages through a group's FULL
 * archive (ZH3: 1,476 past events; WSH3: 309; Richmond: ~1,500 across 4 kennels).
 *
 * Every node is mapped with the live adapter's own `apolloEventsToRawEvents`
 * (title cleaning, hare / run-number / cost extraction, kennel routing,
 * cancelled + admin-notice skips), so archived runs follow the same rules.
 *
 * Gap rule (conservative): only rows whose routed kennel has NO Event on that
 * date (any status) are written. Runs already in HashTracks are left untouched.
 * The source must be `upcomingOnly: true` before APPLY, or the next scrape's
 * reconcile would cancel the backfilled past runs.
 *
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-meetup-gql-history.ts --source "Zurich H3 Meetup"
 *   Apply:    BACKFILL_APPLY=1 BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-meetup-gql-history.ts --source "Zurich H3 Meetup"
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { reportAndApplyBackfill } from "./lib/backfill-runner";
import { logPerKennelTally } from "./lib/backfill-reporting";
import {
  apolloEventsToRawEvents,
  dedupByDate,
  type ApolloEvent,
  type MeetupConfig,
} from "@/adapters/meetup/adapter";
import type { RawEventData } from "@/adapters/types";
import { SOURCES } from "../prisma/seed-data/sources";

const GQL_URL = "https://www.meetup.com/gql2";
const PAGE_SIZE = 50;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const QUERY = `query($u:String!,$a:String){ groupByUrlname(urlname:$u){ timezone events(status: PAST, first: ${PAGE_SIZE}, sort: ASC, after:$a){ totalCount pageInfo{ hasNextPage endCursor } edges{ node{ id title dateTime endTime status description eventUrl venue{ name address city state lat lon } } } } } }`;

interface GqlNode {
  id: string;
  title?: string;
  dateTime?: string;
  endTime?: string;
  status?: string;
  description?: string;
  eventUrl?: string;
  venue?: { name?: string; address?: string; city?: string; state?: string; lat?: number; lon?: number } | null;
}

interface GqlPage {
  data?: {
    groupByUrlname?: {
      timezone?: string;
      events?: {
        totalCount: number;
        pageInfo: { hasNextPage: boolean; endCursor?: string };
        edges: { node: GqlNode }[];
      };
    } | null;
  };
  errors?: { message: string }[];
}

async function fetchPage(urlname: string, after?: string): Promise<GqlPage> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ query: QUERY, variables: { u: urlname, a: after ?? null } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return (await res.json()) as GqlPage;
    if (attempt >= 3) throw new Error(`gql2 HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

/** Map a gql2 node to the Apollo-state Event shape the adapter consumes. */
function toApolloEvent(n: GqlNode): ApolloEvent {
  return {
    __typename: "Event",
    id: n.id,
    title: n.title,
    dateTime: n.dateTime,
    endTime: n.endTime,
    // gql2 reports finished events as "PAST"; keep CANCELLED so the adapter skips it.
    status: n.status === "CANCELLED" ? "CANCELLED" : "PUBLISHED",
    description: n.description,
    eventUrl: n.eventUrl,
    venue: n.venue
      ? { name: n.venue.name, address: n.venue.address, city: n.venue.city, state: n.venue.state, lat: n.venue.lat, lng: n.venue.lon }
      : null,
  };
}

async function main(): Promise<void> {
  const argIdx = process.argv.indexOf("--source");
  const sourceName = argIdx > 0 ? process.argv[argIdx + 1] : undefined;
  if (!sourceName) throw new Error('Usage: --source "<Source.name>"');

  const source = await prisma.source.findFirst({
    where: { name: sourceName, type: "MEETUP" },
    select: { name: true, config: true, kennels: { select: { kennel: { select: { id: true, kennelCode: true } } } } },
  });
  if (!source) throw new Error(`MEETUP source "${sourceName}" not found`);
  // --seed-config previews with the committed seed config (e.g. routing fixes whose
  // data migration hasn't deployed yet). APPLY should run after the migration, so
  // the live DB config and the seed agree.
  const seedRow = SOURCES.find((s) => s.name === source.name && s.type === "MEETUP");
  const useSeed = process.argv.includes("--seed-config") && !!seedRow;
  const config = (useSeed ? seedRow!.config : source.config) as unknown as MeetupConfig;
  console.log(`Config: ${useSeed ? "seed-data/sources.ts" : "live DB row"}`);
  if ((config as unknown as Record<string, unknown>)?.upcomingOnly !== true) {
    console.warn("WARNING: source is not upcomingOnly — do NOT apply until it is (reconcile would cancel past runs).");
  }

  console.log(`[1/3] Paging gql2 past events for ${config.groupUrlname}…`);
  const nodes: GqlNode[] = [];
  let tz = "UTC";
  let after: string | undefined;
  let total = 0;
  for (;;) {
    const page = await fetchPage(config.groupUrlname, after);
    if (page.errors?.length) throw new Error(`gql2 error: ${page.errors[0].message}`);
    const group = page.data?.groupByUrlname;
    if (!group?.events) throw new Error("gql2: group or events missing");
    // Remote value: keep only IANA-zone characters before it is logged or used.
    tz = (group.timezone ?? tz).replaceAll(/[^\w/+-]/g, "");
    total = group.events.totalCount;
    nodes.push(...group.events.edges.map((e) => e.node));
    if (!group.events.pageInfo.hasNextPage) break;
    after = group.events.pageInfo.endCursor;
  }
  console.log(`  ${nodes.length}/${total} past events (group tz ${tz})`);
  if (nodes.length < total) throw new Error("gql2 pagination ended early — aborting");

  console.log("[2/3] Mapping with the live adapter rules + gap filter…");
  const converted = apolloEventsToRawEvents(dedupByDate(nodes.map(toApolloEvent)), {}, config);
  console.log(
    `  mapped ${converted.events.length}; cancelled-skipped ${converted.cancelledSkipped}, ` +
      `admin-notice-skipped ${converted.adminNoticeSkipped}, errors ${converted.errors.length}`,
  );

  const kennelIdByCode = new Map(source.kennels.map((sk) => [sk.kennel.kennelCode, sk.kennel.id]));
  const existing = await prisma.event.findMany({
    where: { kennelId: { in: [...kennelIdByCode.values()] } },
    select: { kennelId: true, date: true },
  });
  const held = new Set(existing.map((e) => `${e.kennelId}|${e.date.toISOString().slice(0, 10)}`));
  const seen = new Set<string>();
  const gaps: RawEventData[] = [];
  let alreadyHeld = 0;
  // Same-date duplicates on Meetup (WSH3 2025-03-15 is posted at both 03:00 and
  // 15:00): keep the copy with a plausible start time.
  const implausible = (e: RawEventData) => {
    const h = e.startTime ? Number(e.startTime.slice(0, 2)) : 12;
    return h < 6 || h > 22 ? 1 : 0;
  };
  const ordered = [...converted.events].sort(
    (a, b) => a.date.localeCompare(b.date) || implausible(a) - implausible(b),
  );
  for (const ev of ordered) {
    const kennelId = kennelIdByCode.get(ev.kennelTags[0]);
    const key = `${kennelId}|${ev.date}`;
    if (kennelId && held.has(key)) {
      alreadyHeld++;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    gaps.push(ev);
  }
  console.log(`  already in HashTracks: ${alreadyHeld}; new: ${gaps.length}`);
  logPerKennelTally(gaps);
  const defaultBucket = gaps.filter((g) => g.kennelTags[0] === config.kennelTag);
  if (config.kennelPatterns?.length && defaultBucket.length) {
    console.log(`  Default-bucket (${config.kennelTag}) title samples:`);
    for (const g of defaultBucket.filter((_, i) => i % Math.ceil(defaultBucket.length / 15) === 0)) {
      console.log(`    ${g.date}  ${g.title ?? "—"}`);
    }
  }

  console.log("[3/3] Reporting + applying…");
  await reportAndApplyBackfill({
    apply: process.env.BACKFILL_APPLY === "1",
    sourceName: source.name,
    events: gaps,
    kennelTimezone: tz,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
