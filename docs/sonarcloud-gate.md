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

`sonar-project.properties` lists exclusions for:
- `sonar.cpd.exclusions`: `prisma/seed.ts`, `prisma/seed-data/**/*.ts`, `src/lib/admin/*-prompt.test.ts`, `src/adapters/hare-extraction.test.ts` — duplication only
- `sonar.exclusions`: `docs/mockups/**` — full analysis (static design references, not shipped code)

> **Important:** SonarCloud Automatic Analysis ignores `sonar-project.properties` — exclusions must also be set in the SonarCloud UI (Project Settings → Analysis Scope) for them to take effect. Until that UI config is in place, the duplication gate condition counts seed-data files. See [#1267](https://github.com/johnrclem/hashtracks-web/issues/1267).

## Phase B status

Phase B sweep landed via [#1141](https://github.com/johnrclem/hashtracks-web/issues/1141): all 398 hotspots in `TO_REVIEW` were triaged through the SonarQube MCP (most SAFE-resolved with per-hotspot context, 16 FIXED inline via HTTPS upgrades on kennel-website seed URLs that actually serve TLS), and the 6 BUG findings on `main` were resolved (5 mockup wireframes marked WONTFIX, 1 conditional-keyboard-handler false-positive). Verifiable at <https://sonarcloud.io/project/security_hotspots?id=johnrclem_hashtracks-web> (filter to `Reviewed`) and via `mcp__sonarqube__quality_gate_status`.

Current `main` gate: 5 of 6 conditions OK. The remaining ERROR is `new_duplicated_lines_density` (4.5% > 3% threshold). By directory: `src/adapters` 3,705 dup lines (mostly test fixtures), `prisma` 2,425, `src/pipeline` 1,368. Closing it has two prerequisites tracked in [#1267](https://github.com/johnrclem/hashtracks-web/issues/1267):
1. **SonarCloud UI exclusions** for the patterns currently in `sonar.cpd.exclusions` (the in-repo properties file is inert under Automatic Analysis). This alone resolves the seed-data contribution (~2,425 lines) but is **not sufficient** — the existing CPD exclusion list does not cover generic adapter test fixtures.
2. **Adapter test fixture deduping** for `src/adapters/**/*.test.ts` — either by adding a broader pattern to the UI CPD exclusions, or by refactoring shared fixtures via `it.each` tables and shared helpers.

If new hotspots or bugs accrue, query them with `mcp__sonarqube__hotspots` (`project_key="johnrclem_hashtracks-web"`, `status="TO_REVIEW"`) from Claude Code, or browse <https://sonarcloud.io/project/security_hotspots?id=johnrclem_hashtracks-web>.

## Why we don't use "previous version" for the PR new-code period

Sonar's "previous version" mode resets the baseline whenever `package.json` (or another version source) bumps. This repo is `0.1.0` with no release/version-bump discipline, so "previous version" would either:
- Never reset (everything in the project is "new"), or
- Reset only when someone manually bumps the version (unpredictable and easy to forget)

Branch-based ("since branch from main") is the right baseline for trunk-based development like this one.
