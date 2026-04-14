#!/usr/bin/env -S npx tsx

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SOURCES } from "../prisma/seed-data/sources";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const includeExisting = args.includes("--include-existing");
const onlyArg = args.find((arg) => arg.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").map((item) => item.trim()).filter(Boolean)) : null;
const today = new Date().toISOString().slice(0, 10);

const meetupSources = SOURCES.filter((source) => source.type === "MEETUP");
const summary: Array<{ source: string; kennel: string; status: "ok" | "skipped" | "failed"; detail: string }> = [];

function run(cmd: string, cmdArgs: string[], extraEnv: Record<string, string> = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${cmdArgs.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function sh(command: string, env: Record<string, string> = {}) {
  run("zsh", ["-lc", command], env);
}

function batchFilesFor(prefix: string) {
  const dir = path.dirname(prefix);
  const base = path.basename(prefix);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.startsWith(base) && name.endsWith(".json"))
    .sort((a, b) => {
      const aNum = Number(a.match(/(\d+)\.json$/)?.[1] ?? 0);
      const bNum = Number(b.match(/(\d+)\.json$/)?.[1] ?? 0);
      return aNum - bNum;
    })
    .map((name) => path.join(dir, name));
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

for (const source of meetupSources) {
  const config = (source.config ?? {}) as { kennelTag?: string };
  const defaultKennel = config.kennelTag;
  const url = source.url;

  if (typeof defaultKennel !== "string" || !defaultKennel) {
    console.log(`Skipping ${source.name}: missing config.kennelTag`);
    summary.push({ source: source.name, kennel: "?", status: "skipped", detail: "missing config.kennelTag" });
    continue;
  }
  if (typeof url !== "string" || !url.includes("meetup.com")) {
    console.log(`Skipping ${source.name}: missing Meetup URL`);
    summary.push({ source: source.name, kennel: defaultKennel, status: "skipped", detail: "missing Meetup URL" });
    continue;
  }
  if (only && !only.has(defaultKennel) && !only.has(source.name)) continue;

  const batchPrefix = `scripts/data/${defaultKennel}-meetup-history-batch-`;
  const existing = batchFilesFor(batchPrefix);
  if (existing.length > 0 && !includeExisting) {
    console.log(`Skipping ${source.name}: found ${existing.length} existing batch files`);
    summary.push({ source: source.name, kennel: defaultKennel, status: "skipped", detail: `found ${existing.length} existing batch files` });
    continue;
  }

  try {
    console.log(`\n=== ${source.name} (${defaultKennel}) ===`);
    sh(
      [
        "npx -y -p playwright -c",
        shellQuote(
          [
            "node scripts/scrape-meetup-history.mjs",
            "--url", `${url.replace(/\/$/, "")}/events/?type=past`,
            "--before-date", today,
          "--batch-prefix", batchPrefix,
          "--batch-start", "1",
          "--wait-ms", "750",
          "--stable-rounds", "12",
          "--max-rounds", "300",
        ].join(" "),
      ),
    ].join(" "),
    );

    const files = batchFilesFor(batchPrefix);
    if (files.length === 0) {
      console.log(`No batch files written for ${source.name}; skipping import`);
      summary.push({ source: source.name, kennel: defaultKennel, status: "skipped", detail: "no batch files written" });
      continue;
    }

    const sourceName = shellQuote(source.name);
    const importCmd =
      `cat ${batchPrefix}*.json | npx tsx scripts/import-meetup-history.ts --source ${sourceName}`;
    sh(importCmd);

    if (apply) {
      sh(importCmd, { BACKFILL_APPLY: "1" });
    }
    summary.push({ source: source.name, kennel: defaultKennel, status: "ok", detail: `batches=${files.length}${apply ? ", applied" : ", dry-run only"}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`FAILED ${source.name}: ${message}`);
    summary.push({ source: source.name, kennel: defaultKennel, status: "failed", detail: message });
  }
}

console.log("\n=== Summary ===");
for (const item of summary) {
  console.log(`${item.status.toUpperCase()}\t${item.kennel}\t${item.source}\t${item.detail}`);
}
