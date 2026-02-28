# Self-Healing Automation Loop — Architecture & Implementation Plan

## Context

HashTracks currently has a sophisticated alert system that detects scraper failures, data quality drops, and structural changes across 29 data sources. When issues are detected, an admin manually clicks "File GitHub Issue" to create a structured issue, then manually investigates and fixes the code. This plan designs an automated loop where: alerts auto-create GitHub issues → an AI agent triages and diagnoses → if confidence is high, the agent implements a fix and opens a PR for human review.

---

## Task 1: Industry Research — Viable Approaches

### Approach A: Claude Code GitHub Actions (Recommended)

**What it is:** `anthropics/claude-code-action@v1` — already partially deployed in this repo. Supports issue-triggered automation, autonomous code changes, and PR creation.

**Why it fits:**
- Already integrated (two workflows exist: `claude.yml` for interactive, `claude-code-review.yml` for PR review)
- Reads and respects `CLAUDE.md` (comprehensive project context already written)
- Native GitHub integration: label triggers, assignee triggers, automation mode
- Supports `--max-turns`, `--allowedTools`, model selection (`claude-opus-4-6`)
- PR code review already runs on every PR via plugin

**Trade-offs:** Tied to Anthropic API costs; limited to GitHub Actions runner capabilities; no persistent memory across runs.

**Sources:**
- [Claude Code GitHub Actions docs](https://code.claude.com/docs/en/github-actions)
- [claude-code-action repo](https://github.com/anthropics/claude-code-action)
- [GitHub Agentic Workflows](https://github.blog/ai-and-ml/automate-repository-tasks-with-github-agentic-workflows/)

### Approach B: OpenHands (Open-Source Agent Framework)

**What it is:** Open-source coding agent (65K+ GitHub stars) with a GitHub resolver that auto-fixes issues tagged with a label. Runs in Docker containers.

**Why consider it:** 72% resolution rate on SWE-Bench Verified; self-hosted for cost control; sandboxed execution.

**Why not primary:** Requires self-hosting infrastructure (Docker, compute); more complex setup than a GitHub Action; less native GitHub integration; no existing integration in this repo.

**Sources:**
- [OpenHands](https://openhands.dev/)
- [OpenHands vs SWE-Agent comparison](https://localaimaster.com/blog/openhands-vs-swe-agent)

### Approach C: Custom CI Feedback Loop (Dagger/Semaphore Pattern)

**What it is:** Build a bespoke pipeline: CI failure → AI analysis → fix attempt → test → PR. Used by Elastic ("Self Healing PRs" — saved 20 dev-days/month).

**Why not primary:** Highest engineering investment; HashTracks has <50 sources making this over-engineered; Claude Code Actions achieves 90% of this with 10% of the effort.

**Sources:**
- [Dagger self-healing pipelines](https://dagger.io/blog/automate-your-ci-fixes-self-healing-pipelines-with-ai-agents)
- [Semaphore + Copilot self-healing CI](https://semaphore.io/blog/copilot-agent-cloud)
- [Elastic self-correcting monorepos](https://www.elastic.co/search-labs/blog/ci-pipelines-claude-ai-agent)

### Recommendation: **Approach A (Claude Code GitHub Actions)** as primary

Rationale: Lowest integration cost (already deployed), native GitHub flow, respects existing CLAUDE.md, PR review already automated. Supplement with CI test enforcement (from Approach C) to validate agent-generated PRs.

---

## Task 2: Codebase Readiness Assessment

### Test Coverage — Score: 7/10

| Area | Test Files | Status |
|------|-----------|--------|
| Adapters (HTML scrapers, APIs) | 28 | Strong |
| Pipeline (merge, health, scrape) | 8 | Strong |
| Server Actions | 21 | Good |
| Libraries/Utilities | 24 | Good |
| API Routes | 1 | Weak |
| UI Components | 4 | Weak |

**Strengths:**
- 84 test files, ~20,100 lines of test code
- Comprehensive adapter tests with real HTML fixtures
- Pipeline tests with Prisma mocking patterns
- TypeScript strict mode provides compile-time safety

**Gaps (Must Fix for Self-Healing):**
- No test execution in CI — agent PRs can't be validated automatically
- No coverage thresholds enforced
- No integration tests (adapter → merge → health chain untested end-to-end)
- API routes largely untested

### Observability — Score: 6/10

**Strengths:**
- Excellent structured alert system (7 alert types with rich context metadata)
- `ErrorDetails` interface categorizes errors: fetch, parse, merge — with row-level context
- ScrapeLog captures full lifecycle (errors, durations, fill rates, samples)
- AI recovery metrics tracked (`attempted`, `succeeded`, `failed`)
- Alert context includes baseline comparisons, suggested approaches, relevant files

**Gaps:**
- No structured logging library (only 27 console.log/error statements)
- No external error tracking (no Sentry/Datadog)
- Silent failures in merge pipeline (errors caught but swallowed)
- No request-scoped tracing

**Key Insight:** For the scraper domain specifically, observability is *better than most codebases* because alerts already contain exactly the context an LLM needs: error messages, affected files, suggested approaches, and fill rate metrics.

### Modularity — Score: 9/10

**Strengths:**
- Factory pattern adapter registry (`src/adapters/registry.ts`) — truly pluggable
- `SourceAdapter` interface enforces consistent behavior across all 29 adapters
- Pipeline modules cleanly separated (scrape → merge → health → reconcile)
- No circular dependencies (DAG-like dependency flow)
- Each adapter is self-contained with its own test file

**This is the codebase's strongest attribute for self-healing.** An agent can modify one adapter without risk of cascading side effects.

### CI/CD — Score: 3/10 (Critical Blocker)

**Current state:**
- No `npm test` in CI — tests aren't enforced on PRs
- No TypeScript type checking in CI
- No lint enforcement in CI
- No coverage reporting
- No pre-commit hooks
- Only Claude code review workflows exist (read-only permissions)

**This is the #1 blocker.** Without CI test enforcement, an AI agent cannot verify its own fixes. This must be addressed in Phase 1.

---

## Task 3: Architecture Proposal

### Recommended Tooling Stack

| Component | Tool | Rationale |
|-----------|------|-----------|
| Agent Framework | `anthropics/claude-code-action@v1` | Already integrated, native GH |
| LLM (triage) | Claude Sonnet 4.6 | Fast, cheap, good for analysis |
| LLM (code gen) | Claude Opus 4.6 | Best reasoning for code changes |
| CI Test Runner | GitHub Actions + Vitest | Validates agent PRs |
| Alert → Issue Bridge | Vercel serverless function | Extends existing `createIssueFromAlert` |
| PR Review | claude-code-review (existing) | Already configured |

### Data Flow: Error → PR

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        TRIGGER LAYER                                │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────────┐  │
│  │ Daily Cron   │   │ User         │   │ External Monitor       │  │
│  │ Scrape       │   │ Feedback     │   │ (future: GCP/Vercel)   │  │
│  └──────┬───────┘   └──────┬───────┘   └──────────┬─────────────┘  │
│         │                  │                       │                │
│         ▼                  ▼                       ▼                │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              health.ts → Alert Generation                    │   │
│  │  (7 types: SCRAPE_FAILURE, STRUCTURE_CHANGE, etc.)          │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     AUTO-ISSUE LAYER (New)                          │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  autoFileIssue() — extends createIssueFromAlert()            │   │
│  │  • Runs after persistAlerts() for CRITICAL/WARNING alerts    │   │
│  │  • Adds label: "claude-fix" for auto-triage                 │   │
│  │  • Adds structured context block for agent consumption       │   │
│  │  • Deduplicates: checks if open issue exists for same alert  │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────────┘
                              │ GitHub Issue created with
                              │ label "claude-fix"
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     AGENT TRIAGE LAYER                              │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  GitHub Actions Workflow: claude-issue-triage.yml             │   │
│  │  Trigger: issues labeled "claude-fix"                        │   │
│  │  Agent: Claude Sonnet 4.6 (fast, cheap)                     │   │
│  │                                                              │   │
│  │  Steps:                                                      │   │
│  │  1. Read issue body (alert context, error details)           │   │
│  │  2. Read relevant files listed in issue                      │   │
│  │  3. Classify: { category, rootCause, confidence, canAutoFix }│   │
│  │  4. Post triage comment with analysis                        │   │
│  │  5. If canAutoFix && confidence >= threshold:                │   │
│  │     → Add label "claude-autofix"                            │   │
│  │  6. If confidence < threshold:                               │   │
│  │     → Add label "needs-human" + detailed diagnosis           │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────────┘
                              │ (only if "claude-autofix" label added)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     AGENT FIX LAYER                                 │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  GitHub Actions Workflow: claude-autofix.yml                  │   │
│  │  Trigger: issues labeled "claude-autofix"                    │   │
│  │  Agent: Claude Opus 4.6 (best reasoning)                    │   │
│  │                                                              │   │
│  │  Steps:                                                      │   │
│  │  1. Checkout repo, install deps, run existing tests          │   │
│  │  2. Read issue + triage comment for diagnosis                │   │
│  │  3. Implement fix (Edit, Write tools)                        │   │
│  │  4. Write/update tests for the fix                           │   │
│  │  5. Run npm test — verify all tests pass                     │   │
│  │  6. Run npm run build — verify build succeeds                │   │
│  │  7. Create PR linking to issue                               │   │
│  │  8. PR triggers claude-code-review.yml (existing)            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Confidence Scoring Rubric

The agent assigns a confidence score during triage. Score determines the action taken.

| Factor | Points | Description |
|--------|--------|-------------|
| **Error Clarity** | 0–25 | Is the error message specific and actionable? (stack trace with line number = 25, vague "scrape failed" = 5) |
| **Root Cause Isolation** | 0–25 | Can the fix be isolated to a single file? (single adapter = 25, multi-module = 10, unclear = 0) |
| **Test Coverage** | 0–20 | Does the affected module have tests? (>80% = 20, >50% = 15, <50% = 5, none = 0) |
| **Pattern Match** | 0–15 | Has this type of fix succeeded before? (CSS selector update = 15, new adapter logic = 5) |
| **Blast Radius** | 0–15 | How many other modules could be affected? (isolated adapter = 15, pipeline = 10, shared util = 5) |

**Action thresholds:**

| Score | Action |
|-------|--------|
| **80–100** | Auto-fix: Agent implements fix, creates PR |
| **60–79** | Assisted fix: Agent proposes fix in issue comment, waits for human approval to proceed |
| **40–59** | Diagnosis only: Agent posts root cause analysis, suggests approach, labels "needs-human" |
| **0–39** | Escalate: Agent flags as too complex, labels "needs-human", notifies via comment |

**High-confidence auto-fix categories (most common for HashTracks):**

1. **CSS selector updates** (STRUCTURE_CHANGE): Site HTML changed, adapter selectors need updating. Single file, well-tested, isolated. Typical score: 85-95.
2. **Kennel alias additions** (UNMATCHED_TAGS): New kennel tag appeared, needs alias in seed.ts. Data-only change. Typical score: 90-100.
3. **Date format adjustments** (FIELD_FILL_DROP on date field): Source changed date format. Single parser function. Typical score: 80-90.
4. **API response schema changes** (SCRAPE_FAILURE): Google Calendar/Sheets API response structure changed. Single adapter. Typical score: 75-85.

---

## Task 4: Implementation Roadmap

### Phase 1: Foundation — CI Test Gate (Week 1)

**Goal:** Ensure all PRs (human and AI) must pass tests before merge.

**Files to create/modify:**

1. **Create `.github/workflows/ci.yml`** — New CI workflow
   ```yaml
   name: CI
   on:
     pull_request:
       types: [opened, synchronize, reopened]
     push:
       branches: [main]
   jobs:
     test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 20
             cache: npm
         - run: npm ci
         - run: npx tsc --noEmit
         - run: npm run lint
         - run: npm test
   ```

2. **Update `.github/workflows/claude.yml`** — Upgrade permissions for autonomous work
   - Change `contents: read` → `contents: write`
   - Change `pull-requests: read` → `pull-requests: write`
   - Add `assignee_trigger: "claude"` and `label_trigger: "claude-fix"`

3. **Enable branch protection on `main`** — Require CI to pass before merge

**Verification:** Open a test PR, confirm CI runs tests, confirm branch protection blocks merge on failure.

---

### Phase 2: Auto-Issue Creation + Triage (Weeks 2–3)

**Goal:** Alerts automatically create GitHub issues; Claude triages them with a diagnosis comment.

**Files to modify:**

1. **`src/pipeline/scrape.ts`** — Add auto-issue filing after alert persistence
   - After `persistAlerts()` call, invoke new `autoFileIssuesForAlerts()` function
   - Only file for CRITICAL severity + specific WARNING types (STRUCTURE_CHANGE, CONSECUTIVE_FAILURES)
   - Reuse existing `createIssueFromAlert()` logic from `src/app/admin/alerts/actions.ts`
   - Add "claude-fix" label to auto-filed issues
   - Add structured `<!-- AGENT_CONTEXT -->` block with machine-readable JSON (alert type, source ID, error details, relevant files)
   - Deduplicate: check for existing open issue with same alert type + source before creating

2. **`src/app/admin/alerts/actions.ts`** — Extract issue-filing into a reusable function
   - Refactor `createIssueFromAlert()` (line 418) to separate auth check from issue creation
   - New `fileGitHubIssueForAlert(alert, options: { autoLabel?: boolean })` — callable from both admin UI and pipeline
   - Enhance `getRelevantFiles()` (line 532) to resolve the **actual** adapter file using the URL-based routing in `src/adapters/registry.ts` (`htmlScraperEntries` array), not generic fallbacks
   - Add `<!-- AGENT_CONTEXT -->` HTML comment with machine-readable JSON:
     ```json
     {
       "alertId": "clxyz...",
       "alertType": "STRUCTURE_CHANGE",
       "sourceId": "clxyz...",
       "sourceName": "hashnyc.com",
       "sourceType": "HTML_SCRAPER",
       "sourceUrl": "https://hashnyc.com",
       "severity": "CRITICAL",
       "adapterFile": "src/adapters/html-scraper/hashnyc.ts",
       "testFile": "src/adapters/html-scraper/hashnyc.test.ts",
       "relevantFiles": ["src/adapters/html-scraper/hashnyc.ts"],
       "context": { "previousHash": "...", "currentHash": "..." }
     }
     ```

3. **Create `.github/workflows/claude-issue-triage.yml`** — Triage workflow
   ```yaml
   name: Claude Issue Triage
   on:
     issues:
       types: [labeled]
   jobs:
     triage:
       if: github.event.label.name == 'claude-fix'
       runs-on: ubuntu-latest
       permissions:
         contents: read
         issues: write
         pull-requests: read
         id-token: write
       steps:
         - uses: actions/checkout@v4
         - uses: anthropics/claude-code-action@v1
           with:
             claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
             prompt: |
               You are triaging a HashTracks scraper alert that was auto-filed as a GitHub issue.

               ISSUE NUMBER: ${{ github.event.issue.number }}
               ISSUE TITLE: ${{ github.event.issue.title }}
               ISSUE BODY: ${{ github.event.issue.body }}

               Instructions:
               1. Read the issue body to understand the alert type and context
               2. Read the relevant files listed in the issue
               3. Identify the root cause of the failure
               4. Assess your confidence in diagnosing AND fixing this issue (0-100)
               5. Post a comment with your analysis in this format:

               ## Triage Analysis
               **Root Cause:** [description]
               **Affected Files:** [list]
               **Proposed Fix:** [description]
               **Confidence Score:** [0-100]
               **Score Breakdown:**
               - Error Clarity: X/25
               - Root Cause Isolation: X/25
               - Test Coverage: X/20
               - Pattern Match: X/15
               - Blast Radius: X/15
               **Recommendation:** [AUTO-FIX / NEEDS-HUMAN]

               If confidence >= 80, add the label "claude-autofix" to this issue.
               If confidence < 80, add the label "needs-human" to this issue.
             claude_args: |
               --model claude-sonnet-4-6
               --max-turns 15
   ```

**Verification:**
- Trigger a manual scrape of a test source that's known to produce alerts
- Verify issue auto-created with correct labels and context
- Verify Claude triage workflow fires and posts analysis comment
- Verify label assignment based on confidence score

---

### Phase 3: Autonomous Fix + PR (Weeks 4–6)

**Goal:** For high-confidence issues, Claude implements the fix and creates a PR.

**Files to create:**

1. **Create `.github/workflows/claude-autofix.yml`** — Fix implementation workflow
   ```yaml
   name: Claude Auto-Fix
   on:
     issues:
       types: [labeled]
   jobs:
     autofix:
       if: github.event.label.name == 'claude-autofix'
       runs-on: ubuntu-latest
       permissions:
         contents: write
         issues: write
         pull-requests: write
         id-token: write
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 20
             cache: npm
         - run: npm ci
         - uses: anthropics/claude-code-action@v1
           with:
             claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
             prompt: |
               You are fixing a HashTracks scraper issue that has been triaged and approved for auto-fix.

               REPO: ${{ github.repository }}
               ISSUE NUMBER: ${{ github.event.issue.number }}
               ISSUE TITLE: ${{ github.event.issue.title }}
               ISSUE BODY: ${{ github.event.issue.body }}

               Instructions:
               1. Read all issue comments to understand the triage analysis
               2. Read the affected files identified in the triage
               3. Implement the fix
               4. Update or add tests to cover the fix
               5. Run `npm test` to verify all tests pass
               6. Run `npx tsc --noEmit` to verify types
               7. Create a PR with:
                  - Title: "fix: [concise description] (auto-fix #ISSUE)"
                  - Body: Link to issue, explanation of root cause, what was changed
                  - Label: "auto-fix"

               IMPORTANT CONSTRAINTS:
               - Only modify files in src/adapters/ or prisma/seed.ts for adapter fixes
               - Do not modify pipeline core (merge.ts, health.ts) without explicit approval
               - Do not modify auth, middleware, or API routes
               - If you discover the fix requires changes outside the safe zone, comment on the issue and add "needs-human" label instead
             claude_args: |
               --model claude-opus-4-6
               --max-turns 30
               --allowedTools Read,Edit,Write,Bash
   ```

2. **Add `auto-fix` label handling to `claude-code-review.yml`** — Ensure auto-fix PRs get reviewed with extra scrutiny
   - Add comment in review prompt: "This PR was generated by an AI agent. Review with extra scrutiny. Verify test coverage is adequate."

**Verification:**
- Manually label a test issue with "claude-autofix"
- Verify agent creates branch, implements fix, runs tests, opens PR
- Verify CI runs on the PR and passes
- Verify code review fires on the PR
- Verify PR links back to the issue

---

### Phase 4: Production Hardening (Weeks 7–10)

**Goal:** Rate limiting, monitoring, feedback loop, and safety guardrails.

**Changes:**

1. **Rate Limiting** — Add to auto-issue workflow:
   - Max 3 auto-filed issues per day per source
   - Max 5 total auto-fix PRs per day (prevent runaway costs)
   - Cooldown: Don't re-file for same alert type + source within 48 hours

2. **Feedback Loop** — Track fix success:
   - After PR merged: re-scrape the affected source, verify alert resolves
   - Record outcome in alert `repairLog`: `{ action: "auto_fix", prUrl, merged, alertResolved }`
   - Dashboard: success rate per alert type, per source

3. **Structured Logging** — Add to scrape pipeline:
   - Replace `console.error` with structured JSON logs (source ID, alert type, error category)
   - Consider Vercel Log Drain → external service for long-term analysis

4. **Safety Guardrails:**
   - Allowlist of files the agent can modify (adapters, seed.ts, test files)
   - Blocklist: middleware.ts, auth.ts, db.ts, API routes, pipeline core
   - PR size limit: auto-fix PRs > 500 lines changed → auto-label "needs-human"
   - Require 1 human approval even for auto-fix PRs (never auto-merge)

5. **External Monitoring Integration (Future):**
   - Vercel deployment failures → GitHub issue via webhook
   - Google Cloud Monitoring alerts → Pub/Sub → Cloud Run → GitHub issue
   - Pattern: [cloud-alerting-notification-forwarding](https://github.com/GoogleCloudPlatform/cloud-alerting-notification-forwarding)

---

## Critical Files Reference

| File | Role in Self-Healing |
|------|---------------------|
| `src/pipeline/health.ts` | Alert generation — triggers the loop |
| `src/pipeline/scrape.ts` | Scrape orchestration — where auto-issue filing hooks in |
| `src/app/admin/alerts/actions.ts` | Existing `createIssueFromAlert()` — reuse for auto-filing |
| `src/adapters/types.ts` | `ErrorDetails`, `ParseError` — structured error context |
| `src/adapters/registry.ts` | Adapter factory — agent's primary fix target |
| `src/adapters/html-scraper/*.ts` | Individual scrapers — most common fix targets |
| `prisma/seed.ts` | Kennel aliases — data-only fixes |
| `.github/workflows/claude.yml` | Existing interactive workflow — upgrade permissions |
| `.github/workflows/claude-code-review.yml` | Existing PR review — validates agent PRs |
| `CLAUDE.md` | Project context — agent reads this for codebase understanding |

## Verification Plan

### End-to-End Test Scenario

1. **Simulate a STRUCTURE_CHANGE alert:**
   - Modify a test HTML fixture to break a scraper's CSS selectors
   - Run the scraper against the modified fixture
   - Verify: Alert generated → Issue auto-created → Claude triages → Confidence ≥ 80 → claude-autofix label added → Fix implemented → PR created → CI passes → Code review runs

2. **Simulate an UNMATCHED_TAGS alert:**
   - Add a new kennel tag to a mock scrape response
   - Verify: Alert → Issue → Triage identifies missing alias → Auto-fix adds alias to seed.ts → Tests pass

3. **Simulate a low-confidence scenario:**
   - Create a SCRAPE_FAILURE with vague error message
   - Verify: Triage scores < 80 → "needs-human" label → No auto-fix attempted

4. **Safety test:**
   - Inject an issue requesting changes to `src/lib/auth.ts`
   - Verify: Agent refuses, posts comment explaining the file is outside safe zone

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Agent introduces breaking changes | CI gate (Phase 1) + human review required on all PRs |
| Runaway issue/PR creation | Dedup on alert type+source; concurrency controls; max 5 auto-fix PRs/day |
| Agent commits sensitive data | `.env`/`.env.local` in `.gitignore`; prompt explicitly forbids secret commits |
| Fix passes tests but doesn't resolve production issue | Post-merge verification: next cron scrape checks if alert auto-resolves (Phase 4) |
| Agent modifies wrong adapter | Issue body includes exact adapter file path resolved via `registry.ts` URL mapping |
| Excessive API costs | Triage uses Sonnet (cheap); Opus only for high-confidence fixes; `--max-turns` caps per workflow |

## Cost Estimate

| Workflow | Model | Estimated Tokens/Run | Est. Cost/Run |
|----------|-------|---------------------|---------------|
| Triage (Sonnet 4.6) | claude-sonnet-4-6 | ~50K in, ~5K out | ~$0.30 |
| Auto-fix (Opus 4.6) | claude-opus-4-6 | ~100K in, ~15K out | ~$2.50 |
| Code Review (existing) | claude-sonnet-4-6 | ~30K in, ~3K out | ~$0.15 |
| **Per incident (full loop)** | | | **~$3.00** |

At current alert volume (~2-5 alerts/week), expected monthly cost: **$25–$60** in API usage + GitHub Actions minutes.
