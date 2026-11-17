/**
 * The scheduled-task prompts and manuals share a few lines that must stay identical: the identity
 * preflight that reads the flag in system.md, and the reset line that keeps local settings. S4's
 * write gate also depends on each task's branch prefix. These checks keep them in step.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPS = path.resolve(HERE, "..");
const ONBOARDING = path.resolve(OPS, "../kennel-onboarding");
const read = (file: string): string => readFileSync(file, "utf8");

const PREFIXES: Record<string, string> = {
  "hashtracks-audit-fixer": "audit-fix/",
  "hashtracks-kennel-implement": "onboard/",
  "hashtracks-kennel-onboarding": "onboarding/",
  "hashtracks-kennel-deep-dive": "deep-dive/",
  "hashtracks-hareline-audit": "hareline-audit/",
  "hashtracks-ops-digest": "ops-digest/",
};
const TASKS = Object.keys(PREFIXES);
/** Tasks that post comments, issue bodies or PR bodies with `gh`. */
const POSTING_TASKS = ["hashtracks-audit-fixer", "hashtracks-kennel-implement", "hashtracks-kennel-onboarding"];

const MANUALS = [
  path.join(OPS, "audit-fixer-task.md"),
  path.join(OPS, "daily-digest-task.md"),
  path.join(ONBOARDING, "implement-handoff-prompt.md"),
  path.join(ONBOARDING, "daily-onboarding-prompt.md"),
];
const prompt = (task: string): string => read(path.join(HERE, `${task}.txt`));
const pointer = (task: string): string => read(path.join(HERE, "pointers", `${task}.txt`));

const systemDoc = read(path.join(OPS, "system.md"));
const PREFLIGHT = systemDoc.split("\n").find((line) => line.startsWith("FLAG=$(curl"));

describe("identity preflight", () => {
  it("system.md holds exactly one flag line, in a form the preflight understands", () => {
    const flags = systemDoc.split("\n").filter((line) => line.startsWith("Identity preflight:"));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatch(/^Identity preflight: (?:LOG|STOP unless \S+)$/);
  });

  it.each([...TASKS.map((task) => [`${task}.txt`, prompt(task)]), ...MANUALS.map((file) => [path.basename(file), read(file)])])(
    "%s runs the preflight from system.md",
    (_name, text) => {
      expect(PREFLIGHT).toBeDefined();
      expect(text.split("\n").map((line) => line.trim())).toContain(PREFLIGHT);
    },
  );
});

describe("resets", () => {
  const texts = [...MANUALS.map(read), ...TASKS.map(prompt), ...TASKS.map(pointer), systemDoc];
  const cleanLines = texts.flatMap((text) => text.split("\n").filter((line) => line.includes("git clean")));

  it("every git clean keeps .claude/settings.local.json", () => {
    expect(cleanLines.length).toBeGreaterThan(0);
    for (const line of cleanLines) expect(line).toContain("-e .claude/settings.local.json");
  });
});

describe("pointers", () => {
  it("there is one pointer per prompt, and nothing else", () => {
    expect(readdirSync(path.join(HERE, "pointers")).sort()).toEqual(TASKS.map((task) => `${task}.txt`).sort());
    expect(readdirSync(HERE).filter((file) => file.endsWith(".txt")).sort()).toEqual(
      TASKS.map((task) => `${task}.txt`).sort(),
    );
  });

  it.each(TASKS)("%s's pointer is short and reads its own prompt", (task) => {
    const text = pointer(task).trimEnd();
    expect(text.split("\n").length).toBeLessThanOrEqual(5);
    expect(text).toContain(`docs/ops/scheduled-tasks/${task}.txt`);
  });
});

describe("prompts", () => {
  it.each(TASKS)("%s names its branch prefix, which system.md lists", (task) => {
    expect(prompt(task)).toContain(`\`${PREFIXES[task]}\``);
    expect(systemDoc).toContain(`| \`${PREFIXES[task]}\` | \`${task}\` |`);
  });

  it.each(POSTING_TASKS)("%s scrubs what it posts", (task) => {
    expect(prompt(task)).toContain("npx tsx scripts/scrub.ts");
  });
});
