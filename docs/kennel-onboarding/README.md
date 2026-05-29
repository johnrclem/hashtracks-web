# Kennel Onboarding System

A lightweight system to onboard **one new kennel per day**, researched right the first time, so
kennels don't accumulate audit rework (missing logos, founded years, socials, historical data).

## How it works (research → handoff → local Claude Code → PR)

A **scheduled task in Cowork runs every morning at ~6 AM** and:

1. Reads [`daily-onboarding-prompt.md`](daily-onboarding-prompt.md) — the operating manual that
   merges the [source onboarding playbook](../source-onboarding-playbook.md) **and** every
   completeness field the per-kennel deep dive (`src/lib/admin/deep-dive-prompt.ts`) normally
   catches after the fact.
2. Pulls the top `queued` kennel from [`target-queue.md`](target-queue.md).
3. Dedups against **LIVE production data** (the `hashtracks.xyz` sitemap read via the Chrome MCP
   — *not* the seed files, which are incomplete; the prod DB isn't reachable from the run's
   sandbox), **verifies the source is live** (pulls a real event sample), and harvests full
   metadata (logo, founded year, socials, hash cash, schedule, description, historical-backfill
   availability, coord sanity, pagination depth, end times).
4. Consults [`source-platform-notes.md`](source-platform-notes.md) for platform-specific gotchas
   (Squarespace, Wix, WordPress.com, etc.) — and *appends* to it when something new is learned,
   so the system gets smarter every run.
5. Writes a complete **handoff file** to [`handoffs/`](handoffs/) — verified sample data,
   ready-to-paste seed blocks, adapter plan, and a leading **`▶ FOR CLAUDE CODE`** directive that
   makes the whole file self-executing.
6. Updates the queue + [`run-log.md`](run-log.md), and **refills the queue to ~20** whenever it
   drops to 5 or fewer (dynamic-source kennels only, deduped against the live sitemap).

Then the last mile (implement → PR) happens via Claude Code. The handoff is the brief.

**Default workflow — manual paste into a local Claude Code session:**

```bash
bash scripts/copy-newest-handoff.sh   # alias suggestion: `htn`
```

That copies the newest un-implemented, non-voided handoff to your clipboard (skipping any that
already have an `onboard/<code>-*` branch on origin, so re-runs are idempotent). Paste into a
fresh Claude Code session in `hashtracks-web`; its top directive drives branch → seed → adapter
→ live-verify → tsc/lint/test → PR.

**Why local?** HashTracks adapters routinely need NAS-only resources during live verification —
the NAS `browserRender` service (Wix / Google Sites / SPA scraping) and the residential proxy
sit behind your Tailscale network, reachable from your Mac but not from Anthropic's cloud. Local
sessions hit them; cloud routines can't. Live debugging is also faster locally.

## The files

| File | What it is |
|---|---|
| `daily-onboarding-prompt.md` | The operating manual the daily Cowork run executes. Edit to change the workflow. |
| `target-queue.md` | Ranked backlog. **Cooperatively editable** — reorder/add/strike rows anytime. |
| `source-platform-notes.md` | Self-improving platform memory. Daily run consults + appends. Currently covers Squarespace, Wix, WordPress.com. |
| `handoffs/<date>-<kennel>.md` | One complete onboarding package per run, with the `▶ FOR CLAUDE CODE` directive at the top. |
| `run-log.md` | Append-only log of each run's outcome. |
| `claude-code-routine.md` | **Parked** alternate — cloud-hosted Claude Code routine. See its top note. |

## Cooperating with the queue

It's a plain markdown table — edit it freely. Bump something to Rank 1 to onboard it next, add
your own targets (include a verified dynamic source + confidence), or strike rows you don't want.
The auto-refill only kicks in at ≤5 `queued` rows and only adds dynamic-data kennels deduped
against the live sitemap.

## Alternate implementation paths (parked)

Both kept around in case the situation changes. Neither is the current default.

**Claude Code routine (cloud) — parked.** A `/schedule` routine on Anthropic's infrastructure can
implement the newest committed handoff and open a PR. Full setup in
[`claude-code-routine.md`](claude-code-routine.md). Currently parked because cloud sessions can't
reach NAS-only resources (`browserRender`, residential proxy) over Tailscale. Revisit if those
are exposed publicly (e.g. via Cloudflare Tunnel) or if a kennel pipeline lands that doesn't need
them.

**Local launchd implementer — parked.** Headless `claude` CLI invoked by launchd on the MacMini,
working in an isolated clone (`~/.hashtracks-onboard-bot`). Files at
[`scripts/onboard-implement.sh`](../../scripts/onboard-implement.sh) +
[`scripts/com.hashtracks.onboard-implement.plist`](../../scripts/com.hashtracks.onboard-implement.plist).
Kept as a fallback when you want full hands-off local automation; current default is the manual
paste workflow above since live-debugging beats unattended runs for new-adapter cases.

## Changing the schedule

The schedule lives in the Cowork scheduled task `onboard-daily-kennel` (runs ~6 AM daily). Ask
Claude to change it (e.g. "move the daily kennel onboarding to 7 AM"). Note: scheduled tasks run
only while the Claude desktop app is open; if it's closed at 6 AM, the task runs on next launch.
