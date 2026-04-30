# SonarCloud Quality Gate Conventions

## How the gate is configured

- **Project:** `johnrclem_hashtracks-web`
- **PR new-code period:** "since branch from main" (branch-based baseline)
  - PR analyses only count issues introduced by the PR's diff against `main`.
  - Touching a file with pre-existing issues no longer drags those issues into the PR's "new code" view.
- **`main` new-code period:** "previous version" — but `package.json` is `0.1.0` and there is no release-bump discipline. The `main` gate is currently informational; it does not block deploys (Vercel deploys on push to `main`, not on Sonar status).
- **`new_security_hotspots_reviewed` condition:** kept on the gate, but with the branch-based PR baseline it only fires when a PR introduces *new* hotspots — not when a PR touches a file that has historical hotspots.

## What this means in practice

### When you open a PR
- The Sonar PR check should pass cleanly if your diff doesn't introduce new bugs, vulnerabilities, code smells, or security hotspots.
- If the PR check fails, the failures are *attributable to your diff*. Read the report and address them.

### If a Sonar hotspot appears in your diff
- Triage it: real risk, false positive, or acceptable.
- Mark it `SAFE` or `FIXED` in the SonarCloud UI with a one-line comment explaining why.
- Don't merge with unreviewed hotspots. The gate condition exists for a reason now that it only fires on actual new code.

### If a Sonar reliability/security/maintainability issue appears in your diff
- Treat as a real finding. Either fix in the PR, or open a follow-up issue and SAFE-resolve with a link to the issue.

## What's excluded

`sonar-project.properties` excludes:
- `prisma/seed.ts`, `prisma/seed-data/**/*.ts` — duplication checks (large hand-curated data files)
- `docs/mockups/**` — full Sonar analysis (these are static design references, not shipped code)

## `main` gate is currently ERROR — by design (for now)

The `main` branch gate currently shows ERROR because of historical debt:
- ~399 unreviewed security hotspots accumulated over time
- Reliability rating D from a backlog of medium-severity bugs in test files and mockups

This is **deferred Phase B** of [#1086](https://github.com/johnrclem/hashtracks-web/issues/1086): a one-time SAFE-resolve sweep of the existing hotspots and any genuinely-stale bug findings. PR-gate relief (this doc) lands first; the main-gate green-up follows separately.

If you want to help with Phase B, query unreviewed hotspots via the SonarQube MCP tool from inside Claude Code — invoke the `mcp__sonarqube__hotspots` tool with `project_key="johnrclem_hashtracks-web"` and `status="TO_REVIEW"`. (Note: this is a Claude Code tool name, not a shell command — there is no CLI you can run literally.) For ad-hoc browsing, the SonarCloud web UI works too: <https://sonarcloud.io/project/security_hotspots?id=johnrclem_hashtracks-web>.

Most hotspots are bounded-input regex (`typescript:S5852`) or `http://` URLs in seed files (`typescript:S5332`) — low-risk in context, but each needs a per-hotspot SAFE-resolve.

## Why we don't use "previous version" for the PR new-code period

Sonar's "previous version" mode resets the baseline whenever `package.json` (or another version source) bumps. This repo is `0.1.0` with no release/version-bump discipline, so "previous version" would either:
- Never reset (everything in the project is "new"), or
- Reset only when someone manually bumps the version (unpredictable and easy to forget)

Branch-based ("since branch from main") is the right baseline for trunk-based development like this one.
