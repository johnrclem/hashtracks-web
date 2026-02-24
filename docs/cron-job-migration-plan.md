# Cron Job Migration Plan: Vercel Cron → Alternatives

## Executive Summary

HashTracks currently runs a single daily cron job (`/api/cron/scrape`) via Vercel Cron
on the **Hobby plan**. This plan has a **60-second function timeout**, and the sequential
scraping of 29 sources takes **50–110 seconds** — meaning the cron job is likely already
failing intermittently or will start failing as sources are added.

This document evaluates migration options to solve the timeout problem, improve
reliability, and support future growth (hourly/6h scraping frequencies, more sources).

---

## Current Architecture

```
vercel.json (cron: "0 6 * * *")
  → GET /api/cron/scrape
    → Auth: Bearer CRON_SECRET (timing-safe)
    → Query enabled sources from PostgreSQL (Railway)
    → Filter sources due for scraping (shouldScrape())
    → Sequential loop: for each source → scrapeSource()
      → Adapter fetch (HTTP/API) → Parse → Merge → Reconcile → Health analysis
    → Return JSON summary
```

**Key constraints:**
- 29 active sources, sequential execution
- Per-source runtime: 2–10 seconds
- Total runtime: 50–110 seconds (can spike higher)
- Sources have varying frequencies: hourly, every_6h, daily, weekly
- But the cron is only triggered once/day at 6 AM UTC
- Env vars needed: DATABASE_URL, CRON_SECRET, GOOGLE_CALENDAR_API_KEY, GEMINI_API_KEY, GITHUB_TOKEN, CLERK_SECRET_KEY

**Current pain points:**
1. 60s Hobby timeout means scrapes are timing out
2. Single daily trigger can't serve hourly/every_6h frequencies
3. No retry logic — if one source fails, it's skipped until tomorrow
4. Sequential execution means one slow source delays all others
5. No observability beyond console.log

---

## Option 1: Vercel Cron (Status Quo + Fixes)

### What it is
Keep Vercel Cron but address the timeout problem by either upgrading to Pro or
splitting the cron into smaller functions.

### Sub-options

#### 1a. Upgrade to Vercel Pro ($20/mo)
- Function timeout increases to 300s (or 800s with Fluid Compute)
- Unlimited cron invocations per day
- Can add more cron schedules for hourly sources

#### 1b. Split into per-source cron routes (stay on Hobby)
- Create individual routes: `/api/cron/scrape/[sourceId]`
- Each scrapes one source (2–10s, well within 60s)
- Configure multiple cron entries in vercel.json (up to 100 allowed)
- Stagger schedules to avoid rate limiting

### Pros
- Zero migration effort (especially 1a)
- Integrated with Vercel deployment — deploys automatically
- No external dependencies
- Secrets stay in Vercel dashboard
- Vercel handles HTTPS, DNS, infrastructure

### Cons
- **1a:** $20/mo ongoing cost just for longer timeouts
- **1b:** Managing 29+ cron entries in vercel.json is unwieldy
- **1b:** All cron jobs share the same Hobby plan execution budget
- No built-in retry on failure (Vercel retries the HTTP call, not individual sources)
- Limited monitoring — only Vercel function logs (7-day retention on Hobby)
- Hobby plan has no guaranteed cron precision
- Still sequential within a single function — no parallelism
- No fan-out capability

### Cost
- **1a:** $20/month (Pro plan)
- **1b:** $0 (stay on Hobby, but constrained)

### Verdict
**1a is the simplest fix** if you're willing to pay $20/mo. Buys time but doesn't
solve the architectural issues (no retry, no fan-out, no per-source scheduling).
**1b is fragile** — maintaining 29 cron entries and adding more as sources grow is
a maintenance burden.

---

## Option 2: GitHub Actions Scheduled Workflows

### What it is
Use GitHub Actions `schedule` trigger with cron syntax to run scraping jobs.
Two sub-approaches:

#### 2a. GitHub Actions → curl to Vercel endpoint
```yaml
on:
  schedule:
    - cron: '0 6 * * *'
jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X GET https://hashtracks.com/api/cron/scrape \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            --max-time 300
```

#### 2b. GitHub Actions → run scrape pipeline directly
```yaml
on:
  schedule:
    - cron: '0 6 * * *'
jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx prisma generate
      - run: npx tsx scripts/scrape-all.ts
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          # ... other secrets
```

### Pros
- **Free:** 2,000 minutes/month included (daily 2-min job = ~60 min/month)
- **6-hour timeout** per job — no timeout concerns at all
- **2b can run in Node.js directly** — no HTTP overhead, full access to pipeline
- Can add multiple schedules (hourly, daily) easily
- `workflow_dispatch` allows manual triggering from GitHub UI
- Logs retained for 90 days (vs 7 days on Vercel Hobby)
- Can run sources in parallel using matrix strategies or Promise.all
- Full Node.js runtime (not constrained to serverless)

### Cons
- **Scheduling is unreliable:** [15–30 minute delays are common](https://github.com/orgs/community/discussions/156282), with occasional 1–6+ hour delays during peak load
- **Jobs can be silently dropped** during high GitHub load periods
- **Repository inactivity** (60 days no commits) can auto-disable scheduled workflows
- Schedules tied to default branch — requires push after changes
- **2a still hits Vercel timeout** (same problem, just triggered externally)
- **2b requires all secrets in GitHub** — DATABASE_URL exposed to GitHub Actions
- **2b requires `npm ci`** every run (~30–60s overhead), though cacheable
- **2b creates a parallel execution path** — pipeline code must work outside Next.js context
- No built-in alerting on failure (need to configure notifications)
- Cold start: checkout + install + generate = ~90s before scraping begins
- IP address varies per run — external sites may rate-limit GitHub runner IPs

### Cost
- **$0** on the GitHub Free plan (2,000 min/month)
- If running hourly: 24 runs × ~3 min = 72 min/day = ~2,160 min/month (barely fits)

### Verdict
**Not recommended as primary scheduler.** The unreliable scheduling (15–30min delays,
silent drops) is a dealbreaker for a scraping pipeline that needs consistent timing.
However, it works well as a **backup/fallback trigger** alongside a primary scheduler.
Approach 2b (running directly) is architecturally messy — creates a second execution
path that must stay in sync with the Next.js app.

---

## Option 3: QStash by Upstash (HTTP Message Queue)

### What it is
QStash is an HTTP-based message queue designed for serverless. Instead of a cron
calling one big endpoint, QStash can fan out individual HTTP requests to per-source
endpoints — each completing well within the 60s Hobby timeout.

### How it would work
```
QStash Schedule (cron: "0 6 * * *")
  → POST /api/cron/dispatch
    → For each due source: publish QStash message to /api/cron/scrape/[sourceId]
    → QStash delivers each message as a separate HTTP request
    → Each request scrapes one source (2-10s, within 60s Hobby limit)
    → QStash automatically retries failed deliveries
```

### Architecture
```
QStash Cron Schedule
  ↓
/api/cron/dispatch (lightweight fan-out, <5s)
  ↓ publishes N messages
QStash Queue
  ↓ delivers individually
/api/cron/scrape/source-1  (2-10s each)
/api/cron/scrape/source-2
/api/cron/scrape/source-3
...
```

### Pros
- **Solves the timeout problem** without upgrading Vercel plan
- **Free tier:** 1,000 messages/day (29 sources × 1 daily = 29 messages — plenty)
- **Automatic retries** with configurable backoff (3 retries by default)
- **Fan-out pattern** — sources scraped in parallel, not sequentially
- **Built-in scheduling** — can set per-source cron schedules directly in QStash
- **Vercel integration** available in Vercel Marketplace
- **Dead letter queue** — failed messages are captured for inspection
- Supports delays, deduplication, FIFO ordering
- Lightweight — just HTTP requests, no SDK lock-in
- Request signing for security (verifies messages came from QStash)
- Works with existing Vercel deployment — no separate runtime needed

### Cons
- New external dependency (Upstash account)
- Requires refactoring cron route into per-source endpoints (or a dynamic route)
- QStash message verification replaces CRON_SECRET auth pattern
- Free tier limited to 1,000 messages/day (sufficient now, but hourly × 29 = 696/day)
- Paid tier is $1/100K messages (very cheap but not zero)
- Adds complexity: dispatch → queue → individual handlers
- Debugging requires checking QStash dashboard + Vercel logs

### Cost
- **$0** for current workload (free tier: 1,000 msg/day, need ~29–696/day)
- **~$1/month** if exceeding free tier with hourly sources
- Pay-as-you-go: $1 per 100,000 messages

### Migration Effort
- Create dynamic route `/api/cron/scrape/[sourceId]/route.ts`
- Create dispatch route `/api/cron/dispatch/route.ts`
- Install `@upstash/qstash` SDK
- Configure QStash schedule via dashboard or API
- Add QStash signing key verification
- Remove old vercel.json cron config
- **Estimated effort: 1–2 days**

### Verdict
**Strong option.** Solves timeout, adds retry, enables fan-out — all while staying
on the Hobby plan for $0. The fan-out pattern is architecturally clean and scales
naturally as sources are added.

---

## Option 4: Inngest (Durable Workflow Engine)

### What it is
Inngest is a workflow orchestration platform with native Vercel integration. It
provides durable execution (automatically splits long-running workflows across
multiple serverless invocations), scheduling, retries, and observability.

### How it would work
```typescript
// src/inngest/functions/scrape.ts
export const scrapeAllSources = inngest.createFunction(
  { id: "scrape-all-sources", retries: 3 },
  { cron: "0 6 * * *" },
  async ({ step }) => {
    const sources = await step.run("fetch-sources", async () => {
      return prisma.source.findMany({ where: { enabled: true } });
    });

    const dueSources = sources.filter(s => shouldScrape(s.scrapeFreq, s.lastScrapeAt));

    // Each source runs as a separate durable step — automatic retry per step
    const results = await Promise.all(
      dueSources.map(source =>
        step.run(`scrape-${source.id}`, () => scrapeSource(source.id, { days: source.scrapeDays }))
      )
    );

    return { succeeded: results.filter(r => r.success).length };
  }
);
```

### Pros
- **Durable execution** — if a step fails, only that step is retried
- **Per-step retries** — source A failing doesn't affect source B
- **Native Vercel integration** — auto-syncs on deploy, branch environments
- **Built-in observability** — dashboard shows each step's status, duration, errors
- **Parallel execution** within serverless constraints
- **Step functions** break work into pieces that each fit within timeout
- Free tier: 50,000 runs/month (way more than needed)
- Cancellation, throttling, concurrency controls built in
- TypeScript-first API — fits the codebase style

### Cons
- **Heaviest migration** — new SDK, new function definitions, new mental model
- SDK dependency (`inngest`) added to the project
- Requires Inngest account + Vercel Marketplace integration
- Dashboard is another thing to monitor
- **Pro plan is $75/month** if you outgrow free tier
- Learning curve for step function patterns
- Dev server required for local testing (`npx inngest-cli dev`)
- Vendor lock-in is higher than QStash (more opinionated)

### Cost
- **$0** on free tier (50,000 runs/month — need ~30/day = ~900/month)
- **$75/month** for Pro (if needed for features/limits)

### Migration Effort
- Install `inngest` SDK
- Create Inngest client + function definitions
- Create `/api/inngest` route handler
- Migrate scrape logic into step functions
- Configure via Vercel Marketplace
- Remove vercel.json cron
- **Estimated effort: 2–3 days**

### Verdict
**Best-in-class DX and reliability**, but heavier than needed for this workload.
The step function model is elegant and future-proof, but introduces a new
programming model. Worth considering if you want observability and per-source
retry out of the box.

---

## Option 5: Railway Cron Jobs

### What it is
Since your database is already on Railway, you could run cron jobs there too.
Railway supports cron services — containers that run on a schedule.

### How it would work
- Create a separate Railway service with a Node.js script
- Configure cron schedule in Railway dashboard
- Script connects directly to the Railway PostgreSQL (no network hop)
- Runs the scrape pipeline as a standalone process

### Pros
- Database is local (no network latency for DB queries)
- No serverless timeout — runs as a container
- Railway Hobby plan includes $5/month free credits
- Can run for minutes/hours without timeout
- Direct DB access — no HTTP overhead

### Cons
- **Separate deployment pipeline** — not tied to Vercel deploys
- Must keep scrape pipeline code in sync between Vercel app and Railway service
- Railway cron is less mature than Vercel/GitHub
- Another platform to manage (even though DB is already there)
- Container cold start can add 10-30s
- Limited free tier ($5 credit, which could cover this workload)
- No built-in retry for individual sources
- Monitoring requires Railway dashboard

### Cost
- **~$0–2/month** on Railway Hobby (within $5 free credit)

### Migration Effort
- Create standalone scrape script (extract from Next.js context)
- Configure Railway cron service
- Manage environment variables in Railway
- **Estimated effort: 2–3 days**

### Verdict
**Interesting but adds operational complexity.** Having two deployment targets
(Vercel for the app, Railway for cron) means two places to manage secrets, two
deployment pipelines, and risk of code drift. Not recommended unless you're
already considering moving off Vercel entirely.

---

## Option 6: Trigger.dev (Background Jobs Platform)

### What it is
Open-source platform for background jobs in TypeScript with retries, queues,
and observability. Similar to Inngest but with different trade-offs.

### Pros
- Open source (self-hostable)
- TypeScript-first, Next.js integration
- Built-in retry, scheduling, observability
- Free tier: $5/month credit, 10 concurrent runs

### Cons
- Newer/smaller ecosystem than Inngest
- Self-hosting adds operational burden
- Cloud pricing starts at $10/month
- Another SDK and mental model to learn

### Cost
- **$0** for light usage (free tier)
- **$10/month** for paid features

### Verdict
**Similar to Inngest but less mature.** Unless you specifically want the open-source
angle or self-hosting, Inngest is the safer choice in this category.

---

## Comparison Matrix

| Criteria | Vercel Pro | Vercel Split | GitHub Actions | QStash | Inngest | Railway |
|---|---|---|---|---|---|---|
| **Monthly cost** | $20 | $0 | $0 | $0 | $0 | ~$0 |
| **Timeout risk** | None (300s) | None (<10s/ea) | None (6hr) | None (<10s/ea) | None (durable) | None (container) |
| **Scheduling precision** | Good | Good | Poor (15-30m delay) | Good | Good | Good |
| **Per-source retry** | No | No | No | Yes (auto) | Yes (per-step) | No |
| **Fan-out / parallel** | No | Yes (staggered) | Possible | Yes (native) | Yes (native) | Manual |
| **Observability** | Basic logs | Basic logs | Action logs | Dashboard | Dashboard | Basic logs |
| **Migration effort** | None | Medium | Low–Medium | Low–Medium | Medium–High | Medium |
| **Hourly support** | Yes | Fragile | Unreliable | Yes | Yes | Yes |
| **Vendor lock-in** | Low | Low | Low | Low | Medium | Low |
| **Scales to 100+ sources** | Timeout risk | Unwieldy | OK | Clean | Clean | OK |
| **Stays on Hobby** | No | Yes | Yes | Yes | Yes | N/A |

---

## Recommendation

### Primary: QStash by Upstash (Option 3)

**QStash is the best fit for HashTracks** because it:

1. **Solves the immediate timeout problem** by fan-ning out to per-source endpoints, each
   completing in 2–10s (well within Hobby's 60s limit)
2. **Costs $0** — free tier of 1,000 messages/day covers even hourly scraping of all sources
3. **Adds automatic retries** — if a source fails, QStash retries 3 times with backoff
4. **Enables per-source scheduling** — hourly sources can have their own QStash schedule
5. **Minimal migration** — the existing `scrapeSource()` function is already per-source;
   just needs a thin HTTP wrapper
6. **No new programming model** — still HTTP endpoints, still Vercel functions
7. **Stays on Hobby plan** — no need to upgrade Vercel
8. **Clean fan-out** — scales naturally as sources are added (just more messages)
9. **Vercel Marketplace integration** — unified billing if desired

### Why not the others?

- **Vercel Pro:** $20/mo just for longer timeouts — doesn't solve retry, fan-out, or
  per-source scheduling. Band-aid, not a fix.
- **GitHub Actions:** Unreliable scheduling (15–30 min delays, silent drops) is
  unacceptable for a scraping pipeline. Good as a backup, not primary.
- **Inngest:** Excellent platform, but heavier than needed. The step function model
  is overkill for "fetch 29 URLs and process them." Revisit if the pipeline becomes
  significantly more complex (e.g., multi-stage AI workflows).
- **Railway/Trigger.dev:** Add operational complexity without proportional benefit.

### Fallback: Vercel Pro (Option 1a)

If you'd rather not add any external dependency, upgrading to Vercel Pro ($20/mo)
is the zero-effort fix. You get 300s timeout (or 800s with Fluid Compute), which
comfortably handles 29 sequential sources. This is the right choice if you value
simplicity above all else and don't need per-source retry or fan-out yet.

### Optional Enhancement: GitHub Actions as backup

Regardless of primary choice, consider adding a GitHub Actions workflow as a
**dead-man's switch** — if the primary cron hasn't run by 7 AM UTC, trigger it
manually. This provides resilience against primary scheduler outages.

---

## Migration Plan: QStash Implementation

### Phase 1: Per-Source Endpoint (Day 1)

1. Create `/api/cron/scrape/[sourceId]/route.ts` — single-source scrape handler
2. Accept QStash signature verification OR CRON_SECRET (transition period)
3. Test with existing sources via manual curl

### Phase 2: Dispatch + QStash Integration (Day 1–2)

1. Install `@upstash/qstash` SDK
2. Create `/api/cron/dispatch/route.ts` — queries due sources, publishes QStash messages
3. Configure QStash schedule: `0 6 * * *` → dispatch endpoint
4. Add QSTASH_TOKEN and QSTASH_CURRENT_SIGNING_KEY to Vercel env vars
5. Test end-to-end in preview deployment

### Phase 3: Frequency Support (Day 2)

1. Add additional QStash schedules for hourly/every_6h sources
2. Or: single dispatch at higher frequency (e.g., every hour) with shouldScrape() filter
3. Update vercel.json: remove old cron config

### Phase 4: Monitoring + Cleanup (Day 2)

1. Verify QStash dashboard shows successful deliveries
2. Remove old `/api/cron/scrape` monolithic route
3. Document new architecture in CLAUDE.md
4. Optional: Add GitHub Actions dead-man's switch

---

## Sources

- [Vercel Cron Jobs Pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel Hobby Plan Limits](https://vercel.com/docs/plans/hobby)
- [Vercel Functions Duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel: 100 Cron Jobs Per Project](https://vercel.com/changelog/cron-jobs-now-support-100-per-project-on-every-plan)
- [GitHub Actions Schedule Delays](https://github.com/orgs/community/discussions/156282)
- [GitHub Actions Cron Reliability](https://github.com/orgs/community/discussions/147369)
- [QStash Pricing](https://upstash.com/pricing/qstash)
- [QStash Documentation](https://upstash.com/docs/qstash/overall/pricing)
- [Inngest Pricing](https://www.inngest.com/pricing)
- [Inngest Vercel Integration](https://vercel.com/marketplace/inngest)
- [Trigger.dev Pricing](https://trigger.dev/pricing)
