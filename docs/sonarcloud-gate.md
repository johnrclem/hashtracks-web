# SonarCloud Quality Gate Conventions

## How the gate is configured

- **Project:** `johnrclem_hashtracks-web`
- **PR new-code period:** "since branch from main" (branch-based baseline)
  - PR analyses only count issues introduced by the PR's diff against `main`.
  - Touching a file with pre-existing issues no longer drags those issues into the PR's "new code" view.
- **`main` new-code period:** "previous version" — but `package.json` is `0.1.0` and there is no release-bump discipline. The `main` gate is informational; it does not block deploys (Vercel deploys on push to `main`, not on Sonar status).
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

`sonar-project.properties` lists exclusions for:
- `sonar.cpd.exclusions`: `prisma/seed.ts`, `prisma/seed-data/**/*.ts`, `**/*.test.ts` — duplication only. Test code is intentionally repetitive (clear, locally-readable cases beat DRY); seed data is a hand-curated dataset where every kennel record shares the same shape.
- `sonar.exclusions`: `docs/mockups/**` — full analysis (static design references, not shipped code)

> **Important:** SonarCloud Automatic Analysis ignores `sonar-project.properties` — the same patterns must also be set in the SonarCloud UI under Project Settings → Analysis Scope → Duplications. The repo file exists for in-repo parity; the UI is the source of truth.

## Phase B status

Phase B sweep landed via [#1141](https://github.com/johnrclem/hashtracks-web/issues/1141): all 398 hotspots in `TO_REVIEW` were triaged through the SonarQube MCP (most SAFE-resolved with per-hotspot context, 16 FIXED inline via HTTPS upgrades on kennel-website seed URLs that actually serve TLS), and the 6 BUG findings on `main` were resolved (5 mockup wireframes marked WONTFIX, 1 conditional-keyboard-handler false-positive). Verifiable at <https://sonarcloud.io/project/security_hotspots?id=johnrclem_hashtracks-web> (filter to `Reviewed`) and via `mcp__sonarqube__quality_gate_status`.

Phase B follow-up [#1267](https://github.com/johnrclem/hashtracks-web/issues/1267) closed the remaining `new_duplicated_lines_density` condition by broadening the CPD exclusion to `**/*.test.ts`. The seed-data exclusion alone wasn't enough (4.5% → ~3.17%, still over 3%); test-file duplication was the dominant signal (`src/pipeline/merge.test.ts` alone contributed 778 dup lines). The current `main` gate should be OK on all six conditions.

If new hotspots or bugs accrue, query them with `mcp__sonarqube__hotspots` (`project_key="johnrclem_hashtracks-web"`, `status="TO_REVIEW"`) from Claude Code, or browse <https://sonarcloud.io/project/security_hotspots?id=johnrclem_hashtracks-web>.

## Why we don't use "previous version" for the PR new-code period

Sonar's "previous version" mode resets the baseline whenever `package.json` (or another version source) bumps. This repo is `0.1.0` with no release/version-bump discipline, so "previous version" would either:
- Never reset (everything in the project is "new"), or
- Reset only when someone manually bumps the version (unpredictable and easy to forget)

Branch-based ("since branch from main") is the right baseline for trunk-based development like this one.
