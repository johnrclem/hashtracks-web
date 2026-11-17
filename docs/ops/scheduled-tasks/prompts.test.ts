/**
 * The scheduled-task prompts and manuals share a few lines that must stay identical: the identity
 * preflight that reads the flag in system.md, and the reset line that keeps local settings. S4's
 * write gate also depends on each task's branch prefix, listed once in system.md. These checks keep
 * them in step.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPS = path.resolve(HERE, "..");
const read = (...parts: string[]): string => readFileSync(path.join(...parts), "utf8");

const systemDoc = read(OPS, "system.md");
const systemLines = systemDoc.split("\n");

/** Task → branch prefix, from the `### Branch prefixes` table in system.md. */
const PREFIXES = new Map(
  systemLines.flatMap((line) => {
    const row = /^\| `([a-z-]+\/)` \| `(hashtracks-[a-z-]+)` \|/.exec(line);
    return row ? [[row[2], row[1]] as const] : [];
  }),
);
const TASKS = [...PREFIXES.keys()];
const prompts = new Map(TASKS.map((task) => [task, read(HERE, `${task}.txt`)]));
const pointers = new Map(TASKS.map((task) => [task, read(HERE, "pointers", `${task}.txt`)]));

/** Each task's manual, where its Step 1 lives; the two read-only audits keep theirs in the prompt. */
const MANUALS = new Map([
  ["hashtracks-audit-fixer", read(OPS, "audit-fixer-task.md")],
  ["hashtracks-ops-digest", read(OPS, "daily-digest-task.md")],
  ["hashtracks-kennel-implement", read(OPS, "../kennel-onboarding/implement-handoff-prompt.md")],
  ["hashtracks-kennel-onboarding", read(OPS, "../kennel-onboarding/daily-onboarding-prompt.md")],
]);
const stepOneHolder = (task: string): string => MANUALS.get(task) ?? prompts.get(task) ?? "";
/** Tasks that post comments, issue bodies or PR bodies with `gh`. */
const POSTING_TASKS = ["hashtracks-audit-fixer", "hashtracks-kennel-implement", "hashtracks-kennel-onboarding"];

const PREFLIGHT = systemLines.find((line) => line.startsWith("FLAG=$(curl"));

it("system.md lists a branch prefix for each of the six tasks", () => {
  expect(TASKS).toHaveLength(6);
  expect(new Set(PREFIXES.values()).size).toBe(6);
});

describe("identity preflight", () => {
  it("system.md holds the preflight and exactly one flag line in a form it understands", () => {
    expect(PREFLIGHT).toBeDefined();
    const flags = systemLines.filter((line) => line.startsWith("Identity preflight:"));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatch(/^Identity preflight: (?:LOG|STOP unless \S+)$/);
  });

  it.each(TASKS)("%s runs the preflight from system.md", (task) => {
    expect(stepOneHolder(task).split("\n").map((line) => line.trim())).toContain(PREFLIGHT);
  });
});

it("every git clean keeps .claude/settings.local.json", () => {
  const texts = [...MANUALS.values(), ...prompts.values(), ...pointers.values(), systemDoc];
  const cleanLines = texts.flatMap((text) => text.split("\n").filter((line) => line.includes("git clean")));
  expect(cleanLines.length).toBeGreaterThan(0);
  for (const line of cleanLines) expect(line).toContain("-e .claude/settings.local.json");
});

describe("pointers", () => {
  it("there is one prompt and one pointer per task, and nothing else", () => {
    const expected = TASKS.map((task) => `${task}.txt`).sort();
    expect(readdirSync(path.join(HERE, "pointers")).sort()).toEqual(expected);
    expect(readdirSync(HERE).filter((file) => file.endsWith(".txt")).sort()).toEqual(expected);
  });

  it.each(TASKS)("%s's pointer is short and fetches its own prompt from main", (task) => {
    const text = pointers.get(task)!.trimEnd();
    expect(text.split("\n").length).toBeLessThanOrEqual(5);
    expect(text).toContain(
      `https://raw.githubusercontent.com/johnrclem/hashtracks-web/main/docs/ops/scheduled-tasks/${task}.txt`,
    );
  });
});

describe("prompts", () => {
  it.each(TASKS)("%s names its branch prefix", (task) => {
    expect(prompts.get(task)).toContain(`\`${PREFIXES.get(task)}\``);
  });

  it.each(POSTING_TASKS)("%s scrubs what it posts, in its prompt and its manual", (task) => {
    expect(prompts.get(task)).toContain("npx tsx scripts/scrub.ts");
    expect(MANUALS.get(task)).toContain("npx tsx scripts/scrub.ts");
  });
});
