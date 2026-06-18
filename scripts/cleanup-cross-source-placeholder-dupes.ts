/**
 * One-shot cleanup for #2233 — cross-source duplicate events.
 *
 * Background:
 *   Kennels fed by BOTH a GOOGLE_CALENDAR and a GOOGLE_SHEETS source accumulated
 *   2–3 canonical Events per trail date. The calendar published content-free
 *   stubs ("SH3 #?", "Seattle H3 Trail", empty summaries) and kennel-prefixed
 *   themed entries ("SH3/NBH3 Gender Blender") that never merged with the sheet's
 *   numbered/themed run, and a higher-trust stub title sometimes clobbered the
 *   real theme on the run it DID merge into. The merge-pipeline fix (#2233)
 *   prevents NEW duplicates, but existing RawEvents have stable fingerprints and
 *   are never reprocessed — so the already-forked canonicals need a one-shot
 *   collapse.
 *
 * Strategy (merge-in-place, NOT delete-and-rebuild — preserves Event ids):
 *   Scope = kennels with both a GOOGLE_CALENDAR and a GOOGLE_SHEETS source.
 *   ⚠️ These calendars are SHARED regional calendars: many same-date rows are
 *   GENUINELY DISTINCT events mis-attributed to the host kennel (other kennels'
 *   runs, holidays, memorials, social "hashy hour" notes). So the collapse
 *   mirrors the forward Tier B/C semantics EXACTLY and is conservative — it only
 *   folds a row into the survivor when that row is unmistakably the same trail:
 *   a content-free STUB, the SAME run number, or an EXACT normalized-theme match.
 *   Any row with a distinct real title is LEFT as its own card.
 *
 *   For each (kennel, UTC-date) group of >1 canonical, non-cancelled, non-series
 *   Event:
 *     1. SURVIVOR = run-numbered first, then non-stub, then most complete, then
 *        oldest.
 *     2. HEAL the survivor's title from its OWN RawEvents (sheet-preferred real
 *        theme) when it currently holds a stub/default — undoes the title-clobber
 *        so the surviving card shows run # + real theme; backfill hares too.
 *     3. A loser MERGES into the survivor only if it is a content-free STUB, OR
 *        carries the SAME run number, OR its normalized theme EXACTLY equals the
 *        (healed) survivor theme. Otherwise it is KEPT SEPARATE.
 *     4. Merge = re-point loser RawEvents onto the survivor (keep the audit
 *        trail), move loser EventLinks (dedup by url) + secondary EventKennels,
 *        then delete the now-zero-raw losers via the race-safe `deleteLeakedEvent`
 *        (requireZeroCounts: hares/attendances/kennelAttendances/rawEvents — any
 *        stray row rolls the delete back, so this is fail-safe).
 *   Recompute Kennel.lastEventDate at the end.
 *
 * Safety: a distinct real event is never merged (only stubs / same-run /
 * exact-theme). Groups with attendance / hares on any merged row are additionally
 * protected by `deleteLeakedEvent`'s requireZeroCounts guard (the delete throws
 * and that loser is logged + left intact).
 *
 * Usage:
 *   Dry run: npx tsx scripts/cleanup-cross-source-placeholder-dupes.ts
 *   Apply:   npx tsx scripts/cleanup-cross-source-placeholder-dupes.ts --apply
 *   Limit:   add a kennelCode to scope to one kennel, e.g. `... --apply sh3-wa`
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";
import { isReplaceableDefaultTitle, normalizeThemeTitle, resolveUpdatedTitle, sanitizeHares } from "@/pipeline/merge";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";

interface KennelMeta {
  id: string;
  kennelCode: string;
  shortName: string;
  fullName: string | null;
  aliases: string[];
}

const EVENT_SELECT = {
  id: true,
  date: true,
  runNumber: true,
  title: true,
  haresText: true,
  locationName: true,
  locationAddress: true,
  description: true,
  startTime: true,
  cost: true,
  createdAt: true,
} as const;
type EventRow = {
  id: string;
  date: Date;
  runNumber: number | null;
  title: string | null;
  haresText: string | null;
  locationName: string | null;
  locationAddress: string | null;
  description: string | null;
  startTime: string | null;
  cost: string | null;
  createdAt: Date;
};

/** Count of populated display fields — the survivor tie-break (mirrors merge's completeness intent). */
function completeness(e: EventRow): number {
  return [e.runNumber, e.haresText, e.locationName, e.locationAddress, e.description, e.startTime, e.cost]
    .filter((v) => v != null && v !== "").length;
}

/** Kennels fed by BOTH a GOOGLE_CALENDAR and a GOOGLE_SHEETS source. */
async function calendarSheetKennels(only?: string): Promise<KennelMeta[]> {
  const links = await prisma.sourceKennel.findMany({
    select: { kennelId: true, source: { select: { type: true } } },
  });
  const typesByKennel = new Map<string, Set<string>>();
  for (const l of links) {
    const set = typesByKennel.get(l.kennelId) ?? new Set<string>();
    set.add(l.source.type);
    typesByKennel.set(l.kennelId, set);
  }
  const ids = [...typesByKennel.entries()]
    .filter(([, t]) => t.has("GOOGLE_CALENDAR") && t.has("GOOGLE_SHEETS"))
    .map(([id]) => id);
  if (ids.length === 0) return [];
  const kennels = await prisma.kennel.findMany({
    where: { id: { in: ids }, ...(only ? { kennelCode: only } : {}) },
    select: { id: true, kennelCode: true, shortName: true, fullName: true, aliases: { select: { alias: true } } },
  });
  return kennels.map((k) => ({
    id: k.id,
    kennelCode: k.kennelCode,
    shortName: k.shortName,
    fullName: k.fullName,
    aliases: k.aliases.map((a) => a.alias),
  }));
}

type TitleMeta = { kennelCode: string; shortName: string; fullName: string | null; aliases: string[] };

/** Best real-theme title + hares among a set of RawEvents (sheet-preferred). */
async function bestThemeFromRaws(
  eventIds: string[],
  titleMeta: TitleMeta,
): Promise<{ title?: string; hares?: string }> {
  if (eventIds.length === 0) return {};
  const raws = await prisma.rawEvent.findMany({
    where: { eventId: { in: eventIds } },
    select: { rawData: true, source: { select: { type: true } } },
  });
  let title: string | undefined;
  let titleIsSheet = false;
  let hares: string | undefined;
  for (const r of raws) {
    const data = r.rawData as { title?: unknown; hares?: unknown } | null;
    const isSheet = r.source.type === "GOOGLE_SHEETS";
    const t = typeof data?.title === "string" ? data.title.trim() : "";
    if (t && !isReplaceableDefaultTitle(t, titleMeta) && normalizeThemeTitle(t, titleMeta) !== ""
        && (title === undefined || (isSheet && !titleIsSheet))) {
      title = t;
      titleIsSheet = isSheet;
    }
    const h = typeof data?.hares === "string" ? data.hares.trim() : "";
    if (h && (hares === undefined || isSheet)) hares = h;
  }
  return { title, hares };
}

/** A content-free placeholder: no run number, no hares, and a title that is a
 *  replaceable default OR normalizes to no theme at all ("SH3", "SH3 #?"). */
function isStub(e: EventRow, meta: TitleMeta): boolean {
  return e.runNumber == null
    && !e.haresText
    && (isReplaceableDefaultTitle(e.title, meta) || normalizeThemeTitle(e.title, meta) === "");
}

interface GroupResult { merged: number; healed: number; keptSeparate: number; skippedDelete: number; }
interface Heal { title?: string; hares?: string }

/** Survivor rank: run-numbered (2) beats a real row (1) beats a content-free stub (0). */
function survivorScore(e: EventRow, meta: TitleMeta): number {
  if (e.runNumber != null) return 2;
  return isStub(e, meta) ? 0 : 1;
}

/** The actual trail anchor: highest rank, then most complete, then oldest. */
function pickSurvivor(group: EventRow[], meta: TitleMeta): EventRow {
  return [...group].sort((a, b) =>
    survivorScore(b, meta) - survivorScore(a, meta)
    || completeness(b) - completeness(a)
    || a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
}

/** Title/hares to write onto the survivor when it currently holds a stub/default. */
async function planHeal(survivor: EventRow, meta: TitleMeta, kennelCode: string): Promise<Heal> {
  const { title: bestTitle, hares: bestHares } = await bestThemeFromRaws([survivor.id], meta);
  const stubby = isReplaceableDefaultTitle(survivor.title, meta) || normalizeThemeTitle(survivor.title, meta) === "";
  let title: string | undefined;
  if (bestTitle && stubby) {
    const next = resolveUpdatedTitle(bestTitle, survivor.title, meta, survivor.runNumber, kennelCode);
    if (next !== survivor.title) title = next;
  }
  // Run hares through the same sanitizer the merge pipeline uses — drops
  // placeholders ("TBD") and scrubs PII so the heal can't leak either.
  const hares = survivor.haresText || !bestHares ? undefined : (sanitizeHares(bestHares) ?? undefined);
  return { title, hares };
}

/** Split the group's non-survivor rows: a row folds in ONLY when it is the same
 *  trail (content-free stub, SAME run number, or EXACT normalized-theme match);
 *  everything else is a genuinely distinct event left as its own card. */
function classifyGroup(group: EventRow[], survivor: EventRow, effectiveTheme: string, meta: TitleMeta) {
  const merges: EventRow[] = [];
  const keep: EventRow[] = [];
  for (const e of group) {
    if (e.id === survivor.id) continue;
    const sameRun = survivor.runNumber != null && e.runNumber === survivor.runNumber;
    const themeMatch = effectiveTheme !== "" && normalizeThemeTitle(e.title, meta) === effectiveTheme;
    if (isStub(e, meta) || sameRun || themeMatch) merges.push(e);
    else keep.push(e);
  }
  return { merges, keep };
}

/** `"Title A", "Title B"` — avoids nested template literals in log lines. */
function titleList(rows: EventRow[]): string {
  return rows.map((r) => `"${r.title ?? ""}"`).join(", ");
}

/** Re-point a loser's RawEvents / EventLinks / co-host EventKennels onto the
 *  survivor, then race-safe-delete it. Returns whether the delete succeeded. */
async function foldLoserIntoSurvivor(survivorId: string, loserId: string): Promise<boolean> {
  await prisma.rawEvent.updateMany({ where: { eventId: loserId }, data: { eventId: survivorId } });

  const survivorUrls = new Set(
    (await prisma.eventLink.findMany({ where: { eventId: survivorId }, select: { url: true } })).map((l) => l.url),
  );
  const loserLinks = await prisma.eventLink.findMany({ where: { eventId: loserId }, select: { id: true, url: true } });
  for (const link of loserLinks) {
    if (survivorUrls.has(link.url)) continue;
    await prisma.eventLink.update({ where: { id: link.id }, data: { eventId: survivorId } });
    survivorUrls.add(link.url);
  }

  const survivorKennelIds = new Set(
    (await prisma.eventKennel.findMany({ where: { eventId: survivorId }, select: { kennelId: true } })).map((k) => k.kennelId),
  );
  const loserSecondaries = await prisma.eventKennel.findMany({
    where: { eventId: loserId, isPrimary: false },
    select: { kennelId: true },
  });
  for (const ek of loserSecondaries) {
    if (survivorKennelIds.has(ek.kennelId)) continue;
    await prisma.eventKennel.create({ data: { eventId: survivorId, kennelId: ek.kennelId, isPrimary: false } });
    survivorKennelIds.add(ek.kennelId);
  }

  // Race-safe: throws if hares/attendance/raws sneak in after the re-point above.
  try {
    await deleteLeakedEvent(prisma, loserId, ["hares", "attendances", "kennelAttendances", "rawEvents"]);
    return true;
  } catch (err) {
    console.error(`      ⚠️  refused to delete loser ${loserId} — left intact:`, (err as Error).message);
    return false;
  }
}

async function collapseGroup(
  kennel: KennelMeta,
  day: string,
  group: EventRow[],
  apply: boolean,
  res: GroupResult,
): Promise<void> {
  const meta: TitleMeta = { kennelCode: kennel.kennelCode, shortName: kennel.shortName, fullName: kennel.fullName, aliases: kennel.aliases };
  const survivor = pickSurvivor(group, meta);
  if (!survivor) return; // unreachable (group.length > 1) — guards the sort()[0] access

  const heal = await planHeal(survivor, meta, kennel.kennelCode);
  const effectiveTheme = normalizeThemeTitle(heal.title ?? survivor.title, meta);
  const { merges, keep } = classifyGroup(group, survivor, effectiveTheme, meta);

  res.keptSeparate += keep.length;
  if (merges.length === 0) return; // nothing collapses on this date (all rows distinct)

  console.log(
    `  MERGE ${kennel.kennelCode} ${day}: keep ${survivor.id} ` +
      `(#${survivor.runNumber ?? "—"} "${survivor.title ?? ""}") ← ${merges.length} loser(s): ${titleList(merges)}`,
  );
  if (keep.length > 0) console.log(`      keep separate: ${titleList(keep)}`);
  if (heal.title) console.log(`      heal title: "${survivor.title ?? ""}" → "${heal.title}"`);
  if (heal.hares) console.log(`      heal hares: → "${heal.hares}"`);

  if (!apply) {
    res.merged += merges.length;
    if (heal.title || heal.hares) res.healed++;
    return;
  }

  for (const loser of merges) {
    if (await foldLoserIntoSurvivor(survivor.id, loser.id)) res.merged++;
    else res.skippedDelete++;
  }

  const healData: Record<string, unknown> = {};
  if (heal.title) healData.title = heal.title;
  if (heal.hares) healData.haresText = heal.hares;
  if (Object.keys(healData).length > 0) {
    await prisma.event.update({ where: { id: survivor.id }, data: healData });
    res.healed++;
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const only = process.argv.slice(2).find((a) => a !== "--apply");
  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}${only ? ` (kennel ${only})` : ""}`);

  const kennels = await calendarSheetKennels(only);
  console.log(`Calendar+sheet kennels in scope: ${kennels.map((k) => k.kennelCode).join(", ") || "(none)"}`);

  const res: GroupResult = { merged: 0, healed: 0, keptSeparate: 0, skippedDelete: 0 };
  let dupeGroups = 0;

  for (const kennel of kennels) {
    const events = await prisma.event.findMany({
      where: { kennelId: kennel.id, isCanonical: true, status: { not: "CANCELLED" }, parentEventId: null, isSeriesParent: false },
      select: EVENT_SELECT,
    });
    const byDay = new Map<string, EventRow[]>();
    for (const e of events) {
      const d = e.date.toISOString().slice(0, 10);
      const list = byDay.get(d) ?? [];
      list.push(e);
      byDay.set(d, list);
    }
    const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [day, group] of days) {
      if (group.length <= 1) continue;
      dupeGroups++;
      await collapseGroup(kennel, day, group, apply, res);
    }
  }

  const verb = apply ? "Applied" : "Would apply";
  const refused = res.skippedDelete ? `, ${res.skippedDelete} delete(s) refused by safety guard` : "";
  console.log(
    `\n${verb}: ${dupeGroups} multi-row date-group(s) → ` +
      `${res.merged} stub/same-trail row(s) merged, ${res.healed} survivor title/hares heal(s), ` +
      `${res.keptSeparate} distinct event(s) kept separate${refused}`,
  );

  if (apply && res.merged > 0) {
    const n = await backfillLastEventDates();
    console.log(`Recomputed lastEventDate for ${n} kennel(s).`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
