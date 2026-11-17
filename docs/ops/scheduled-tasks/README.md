# Scheduled-task prompts

The six HashTracks scheduled tasks run in the Claude desktop app on the owner's Mac mini. Their
prompts live here, so a prompt change is a reviewed PR like any other change, and the copy in the
app can't quietly drift from the manuals.

- **`<task>.txt`** is the task's prompt: its role, the identity preflight, where its manual is,
  and the rules it never breaks. Edit these in PRs.
- **`pointers/<task>.txt`** is the only text the scheduled task holds: four lines that fetch the
  prompt from `main` over HTTPS and follow it. The owner pastes a pointer into the app once, and
  again only if that pointer changes; a change to a prompt, a manual or a reset line needs no paste.
  The three tasks that write (fixer, implementer, research) reset their own clone as their prompt's
  first step.
- The ops digest compares each task's `~/.claude/scheduled-tasks/<task>/SKILL.md` with its pointer
  every morning and lists any drift under "Needs you today"
  ([`daily-digest-task.md`](../daily-digest-task.md), Gather 5).
- `prompts.test.ts` checks that every manual (or prompt, for the two tasks without one) carries
  the identity preflight from [`system.md#identity`](../system.md#identity), that every reset line
  keeps `.claude/settings.local.json`, that every pointer fetches its own prompt, and that every
  prompt names its branch prefix from [`system.md#branch-prefixes`](../system.md#branch-prefixes).

| Task | Clone | Manual |
|---|---|---|
| `hashtracks-audit-fixer` | `~/Developer/hashtracks-audit-fixer` | [`audit-fixer-task.md`](../audit-fixer-task.md) |
| `hashtracks-kennel-implement` | `~/Developer/hashtracks-implementer` | [`implement-handoff-prompt.md`](../../kennel-onboarding/implement-handoff-prompt.md) |
| `hashtracks-kennel-onboarding` | `~/Developer/hashtracks-research` | [`daily-onboarding-prompt.md`](../../kennel-onboarding/daily-onboarding-prompt.md) |
| `hashtracks-kennel-deep-dive` | none (read-only) | the prompt itself, plus the agent API's |
| `hashtracks-hareline-audit` | none (read-only) | the prompt itself, plus the agent API's |
| `hashtracks-ops-digest` | none (read-only) | [`daily-digest-task.md`](../daily-digest-task.md) |

## Pasting the pointers (owner)

Do this once, after the PR that adds these files merges. For each of the six tasks:

1. In the Claude desktop app, open the task for editing.
2. Replace its whole prompt with the contents of `pointers/<task>.txt` from `main`, verbatim.
   Leave the schedule, mode, folder and description as they are.
3. Save.

Then run the ops digest once by hand: its "Automations" section should show all six as matching.
A task still listed as `DRIFT` holds something other than its pointer.

Every pointer reads from `main`, so paste them only after the merge.
