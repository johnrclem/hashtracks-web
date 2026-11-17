# Scheduled-task prompts

The six HashTracks scheduled tasks run in the Claude desktop app on the owner's Mac mini. Their
prompts live here, so a prompt change is a reviewed PR like any other change, and the copy in the
app can't quietly drift from the manuals.

- **`<task>.txt`** is the task's prompt: its role, the identity preflight, where its manual is,
  and the rules it never breaks. Edit these in PRs.
- **`pointers/<task>.txt`** is the only text the scheduled task holds: four lines that fetch the
  prompt from `main` and follow it. The owner pastes a pointer into the app once, and again only if
  that pointer changes.
- The ops digest compares each task's `~/.claude/scheduled-tasks/<task>/SKILL.md` with its pointer
  every morning and lists any drift under "Needs you today"
  ([`daily-digest-task.md`](../daily-digest-task.md), Gather 5).
- `prompts.test.ts` checks that every prompt carries the same identity preflight as
  [`system.md#identity`](../system.md#identity), that every reset line keeps
  `.claude/settings.local.json`, and that every pointer reads its own prompt.

| Task | Pointer reads the prompt from | Manual | Branch prefix |
|---|---|---|---|
| `hashtracks-audit-fixer` | its clone, `~/Developer/hashtracks-audit-fixer`, reset to `origin/main` | [`audit-fixer-task.md`](../audit-fixer-task.md) | `audit-fix/` |
| `hashtracks-kennel-implement` | its clone, `~/Developer/hashtracks-implementer`, reset to `origin/main` | [`implement-handoff-prompt.md`](../../kennel-onboarding/implement-handoff-prompt.md) | `onboard/` |
| `hashtracks-kennel-onboarding` | its clone, `~/Developer/hashtracks-research`, reset to `origin/main` | [`daily-onboarding-prompt.md`](../../kennel-onboarding/daily-onboarding-prompt.md) | `onboarding/` |
| `hashtracks-kennel-deep-dive` | `main`, over HTTPS (the task has no clone) | the prompt itself, plus the agent API's | `deep-dive/` (reserved) |
| `hashtracks-hareline-audit` | `main`, over HTTPS (the task has no clone) | the prompt itself, plus the agent API's | `hareline-audit/` (reserved) |
| `hashtracks-ops-digest` | `main`, over HTTPS (the task has no clone) | [`daily-digest-task.md`](../daily-digest-task.md) | `ops-digest/` (reserved) |

The three read-only tasks fetch from `raw.githubusercontent.com` rather than keep a clone: they
never run git, and reading `main` directly means they never follow a feature branch in the owner's
live checkout.

## Pasting the pointers (owner)

Do this once, after the PR that adds these files merges. For each of the six tasks:

1. In the Claude desktop app, open the task for editing.
2. Replace its whole prompt with the contents of `pointers/<task>.txt` from `main`, verbatim.
   Leave the schedule, mode, folder and description as they are.
3. Save.

Then run the ops digest once by hand: its "Automations" section should show all six as matching.
A task still listed as `DRIFT` holds something other than its pointer.

Every pointer reads from `main`, so paste them only after the merge.
