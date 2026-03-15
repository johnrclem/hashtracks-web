Run the full CI check suite locally, matching `.github/workflows/ci.yml`.

Execute in order, stopping on first failure:

1. `npx tsc --noEmit` — TypeScript type checking
2. `npm run lint` — ESLint
3. `npm test` — Vitest (all test files)

Report pass/fail status for each step and any errors encountered.
