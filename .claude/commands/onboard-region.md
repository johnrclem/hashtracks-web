**DEPRECATED** — This skill has been split into two focused skills:

1. `/research-region $ARGUMENTS` — Discover kennels, identify sources, write research file for user review
2. `/ship-sources $ARGUMENTS` — Build adapters, verify live, ship PR (reads the research file)

The two-phase workflow allows user review between discovery and implementation, and includes a self-reflection step to capture learnings.

To onboard a new region, run `/research-region [region name]` first, review the output, then run `/ship-sources`.
