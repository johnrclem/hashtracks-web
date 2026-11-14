/**
 * Create (or re-create) the QStash schedules HashTracks relies on.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20 && npx tsx scripts/setup-qstash-schedule.ts
 *
 * Idempotent: for each schedule below it deletes every existing QStash schedule
 * that targets the same path on any of our hosts, then creates one fresh. Schedules
 * for other paths are left alone.
 *
 * Prerequisites:
 *   - QSTASH_TOKEN in .env
 *
 * Quota: dispatch fans out to roughly 500 messages a day; the hourly promoter
 * adds 24.
 */
import "dotenv/config";
import { Client } from "@upstash/qstash";
import { DEFAULT_SITE_URL } from "../src/lib/site-url";

/** The apex domain 308-redirects to www, so schedules target www directly. */
const BASE_URL = DEFAULT_SITE_URL;
/** Hosts older schedules may still target; their schedules are replaced. */
const LEGACY_BASE_URLS = ["https://hashtracks.xyz", "https://hashtracks.com"];

interface ScheduleSpec {
  path: string;
  cron: string;
  description: string;
}

const SCHEDULES: ScheduleSpec[] = [
  { path: "/api/cron/dispatch", cron: "0 * * * *", description: "scrape dispatch, hourly" },
  {
    // At :05 so a finding submitted just before the hour is filed within the hour.
    // The daily Vercel cron (vercel.json) stays as a backstop.
    path: "/api/cron/promote-audit-findings",
    cron: "5 * * * *",
    description: "audit-finding promotion, hourly",
  },
];

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
if (!QSTASH_TOKEN) {
  console.error("ERROR: QSTASH_TOKEN is not set in .env");
  process.exit(1);
}

const client = new Client({ token: QSTASH_TOKEN });

/** Create `spec`'s schedule, then delete any older one for the same path.
 *  Creating first means a failed create never leaves the path unscheduled. */
async function replaceSchedule(spec: ScheduleSpec, existing: Array<{ scheduleId: string; destination: string }>) {
  const destination = `${BASE_URL}${spec.path}`;
  const targets = new Set([BASE_URL, ...LEGACY_BASE_URLS].map((base) => `${base}${spec.path}`));

  const schedule = await client.schedules.create({ destination, cron: spec.cron, retries: 3 });
  console.log(`Created ${spec.description}: ${schedule.scheduleId}`);
  console.log(`  Cron: ${spec.cron}  Destination: ${destination}`);

  const old = existing.filter(
    (s) => targets.has(s.destination) && s.scheduleId !== schedule.scheduleId,
  );
  await Promise.all(
    old.map((s) => {
      console.log(`Deleting old schedule ${s.scheduleId} (${s.destination})`);
      return client.schedules.delete(s.scheduleId);
    }),
  );
}

async function main() {
  const existing = await client.schedules.list();
  // Each schedule targets a different path, so they can be replaced independently.
  await Promise.all(SCHEDULES.map((spec) => replaceSchedule(spec, existing)));
  console.log("\nVerify at: https://console.upstash.com -> QStash -> Schedules");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
