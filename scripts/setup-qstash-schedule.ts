/**
 * One-time script to create a QStash schedule for hourly scrape dispatch.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20 && npx tsx scripts/setup-qstash-schedule.ts
 *
 * Prerequisites:
 *   - QSTASH_TOKEN in .env
 */
import "dotenv/config";
import { Client } from "@upstash/qstash";

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
const DESTINATION = "https://hashtracks.xyz/api/cron/dispatch";
const OLD_DESTINATION = "https://hashtracks.com/api/cron/dispatch";

if (!QSTASH_TOKEN) {
  console.error("ERROR: QSTASH_TOKEN is not set in .env");
  process.exit(1);
}

const client = new Client({ token: QSTASH_TOKEN });

async function main() {
  const existing = await client.schedules.list();

  // Clean up ALL existing schedules targeting either old or current destination
  const toDelete = existing.filter(
    (s) => s.destination === OLD_DESTINATION || s.destination === DESTINATION,
  );
  for (const s of toDelete) {
    console.log(`Deleting schedule ${s.scheduleId} (${s.destination})`);
    await client.schedules.delete(s.scheduleId);
    console.log("  Deleted.");
  }

  console.log(`\nCreating hourly schedule -> ${DESTINATION}`);

  const schedule = await client.schedules.create({
    destination: DESTINATION,
    cron: "0 * * * *",
    retries: 3,
  });

  console.log("Schedule created successfully!");
  console.log("  Schedule ID:", schedule.scheduleId);
  console.log("  Cron: 0 * * * * (every hour)");
  console.log("  Destination:", DESTINATION);
  console.log("\nVerify at: https://console.upstash.com -> QStash -> Schedules");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
