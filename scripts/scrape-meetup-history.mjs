#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const { chromium } = await import("playwright");

const CURRENT_YEAR = new Date().getUTCFullYear();
const MONTHS = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

function parseArgs(argv) {
  const args = {
    stableRounds: 10,
    chunkSize: 50,
    maxRounds: 150,
    waitMs: 2500,
    width: 1440,
    height: 2200,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--url" && next) args.url = next;
    if (arg === "--before-date" && next) args.beforeDate = next;
    if (arg === "--out" && next) args.out = next;
    if (arg === "--batch-prefix" && next) args.batchPrefix = next;
    if (arg === "--batch-start" && next) args.batchStart = Number(next);
    if (arg === "--chunk-size" && next) args.chunkSize = Number(next);
    if (arg === "--stable-rounds" && next) args.stableRounds = Number(next);
    if (arg === "--max-rounds" && next) args.maxRounds = Number(next);
    if (arg === "--wait-ms" && next) args.waitMs = Number(next);
  }

  if (!args.url || !args.beforeDate) {
    console.error(
      "Usage: node scripts/scrape-meetup-history.mjs --url <meetup-past-events-url> --before-date <YYYY-MM-DD> [--out file.json] [--batch-prefix prefix] [--batch-start N]",
    );
    process.exit(1);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.beforeDate)) {
    console.error(`Invalid --before-date: ${args.beforeDate}`);
    process.exit(1);
  }

  if (args.batchPrefix && !Number.isInteger(args.batchStart)) {
    console.error("--batch-start is required when --batch-prefix is provided");
    process.exit(1);
  }

  return args;
}

function extractDateParts(dateLine) {
  const match = dateLine.match(
    /^[A-Za-z]{3},\s+([A-Za-z]{3})\s+(\d{1,2})(?:,\s+(\d{4}))?\s+·\s+(\d{1,2}:\d{2})\s+([AP]M)/,
  );
  if (!match) return null;

  return {
    month: MONTHS[match[1]],
    day: Number(match[2]),
    year: match[3] ? Number(match[3]) : null,
    time: match[4],
    ampm: match[5],
  };
}

function normalizeLocation(rawLocation) {
  const collapsed = rawLocation.replace(/\s+/g, " ").trim();
  if (!collapsed || collapsed === "·") return null;

  const withoutMapsUrl = collapsed.replace(
    /^https?:\/\/(?:(?:goo\.gl\/maps|maps\.app\.goo\.gl|maps\.google\.com|www\.google\.com\/maps)[^\s,]*)\s*,?\s*/i,
    "",
  ).trim();

  const uppercasedState = withoutMapsUrl.replace(
    /,\s*([a-z]{2})\s*,\s*([a-z]{2}|[A-Z]{2})$/i,
    (_, state, country) => `, ${state.toUpperCase()}, ${country.toUpperCase()}`,
  );

  return uppercasedState || null;
}

function parseCardText(text, url, fallbackYear = CURRENT_YEAR) {
  const rawLines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (rawLines.length < 2) return null;

  const lines = [...rawLines];
  if (/^(Cancelled|Canceled)$/i.test(lines[0])) lines.shift();

  const title = (lines.shift() ?? "").replace(/\s+/g, " ").trim();
  const dateLine = lines.shift() ?? "";
  const dateParts = extractDateParts(dateLine);
  if (!dateParts) return null;

  const year = dateParts.year ?? fallbackYear;
  const month = dateParts.month;
  const day = dateParts.day;
  let [hour, minute] = dateParts.time.split(":").map(Number);
  const ampm = dateParts.ampm;
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  let location = null;
  if (
    lines[0] &&
    !/^\d+ attendees?$/i.test(lines[0]) &&
    !/^by\s+/i.test(lines[0])
  ) {
    location = normalizeLocation(lines[0]);
  }

  let attendees = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const attendeeMatch = lines[i].match(/^(\d+) attendees?$/i);
    if (attendeeMatch) {
      attendees = Number(attendeeMatch[1]);
      break;
    }
  }

  return {
    title,
    date: `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    startTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    location,
    url: url.replace(/\?.*/, ""),
    attendees,
  };
}

async function collectRows(page, beforeDate, waitMs, maxRounds, stableRounds) {
  let lastCount = 0;
  let stable = 0;
  let parsed = [];

  for (let round = 0; round < maxRounds; round += 1) {
    await page.evaluate(() => {
      window.scrollTo(0, document.scrollingElement.scrollHeight);
    });
    await page.waitForTimeout(waitMs);

    const items = await page.evaluate(() => {
      return [...document.querySelectorAll('a[href*="/events/"]')]
        .filter((anchor) => /\/events\/\d+/.test(anchor.href))
        .map((anchor) => ({ href: anchor.href, text: anchor.innerText.trim() }))
        .filter((item) => item.text);
    });

    const next = [];
    const seen = new Set();
    let inferredYear = CURRENT_YEAR;
    let previousMonth = null;
    for (const item of items) {
      const rawLines = item.text.split("\n").map((line) => line.trim()).filter(Boolean);
      const dateLineIndex = /^(Cancelled|Canceled)$/i.test(rawLines[0]) ? 2 : 1;
      const dateParts = extractDateParts(rawLines[dateLineIndex] ?? "");
      if (!dateParts) continue;

      if (dateParts.year != null) {
        inferredYear = dateParts.year;
      } else if (previousMonth != null && dateParts.month > previousMonth) {
        inferredYear -= 1;
      }
      previousMonth = dateParts.month;

      const row = parseCardText(item.text, item.href, inferredYear);
      if (!row || seen.has(row.url)) continue;
      seen.add(row.url);
      next.push(row);
    }

    next.sort((a, b) => a.date.localeCompare(b.date) || a.url.localeCompare(b.url));
    parsed = next;

    const olderCount = parsed.filter((row) => row.date < beforeDate).length;
    console.log(
      `round=${round} total=${parsed.length} older=${olderCount} oldest=${parsed[0]?.date ?? "n/a"}`,
    );

    if (parsed.length === lastCount) stable += 1;
    else stable = 0;
    lastCount = parsed.length;

    if (stable >= stableRounds) break;
  }

  return parsed.filter((row) => row.date < beforeDate);
}

function writeJson(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2) + "\n");
}

function writeBatches(prefix, start, rows, chunkSize) {
  const descending = [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.url.localeCompare(a.url));
  const written = [];

  for (let i = 0; i < descending.length; i += chunkSize) {
    const chunk = descending.slice(i, i + chunkSize);
    const batchNumber = start + written.length;
    const filePath = `${prefix}${batchNumber}.json`;
    writeJson(filePath, chunk);
    written.push({
      filePath,
      count: chunk.length,
      newest: chunk[0]?.date ?? null,
      oldest: chunk.at(-1)?.date ?? null,
    });
  }

  return written;
}

const args = parseArgs(process.argv.slice(2));

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: args.width, height: args.height },
  });
  page.setDefaultTimeout(45_000);

  await page.goto(args.url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('a[href*="/events/"]', { timeout: 15_000 });
  await page.waitForTimeout(1_500);

  const rows = await collectRows(
    page,
    args.beforeDate,
    args.waitMs,
    args.maxRounds,
    args.stableRounds,
  );

  if (args.out) {
    writeJson(args.out, rows);
    console.log(`wrote ${rows.length} rows to ${args.out}`);
  }

  if (args.batchPrefix) {
    const batches = writeBatches(args.batchPrefix, args.batchStart, rows, args.chunkSize);
    for (const batch of batches) {
      console.log(
        `batch ${path.basename(batch.filePath)} count=${batch.count} newest=${batch.newest} oldest=${batch.oldest}`,
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        rows: rows.length,
        oldest: rows[0] ?? null,
        newest: rows.at(-1) ?? null,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
