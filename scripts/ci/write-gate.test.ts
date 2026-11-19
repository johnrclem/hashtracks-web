import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ownerGithubLogin } from "@/lib/backfill/approval-stamp";
import {
  AGENT_BRANCH_PREFIXES,
  classify,
  DEFAULT_AGENT_BOT_LOGIN,
  evaluateGate,
  isOnboardingData,
  parsePusher,
  PUSHER_CONTEXT,
  type ApprovalResult,
  type ChangedFile,
  type GateInput,
} from "./write-gate";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const OWNER = { login: "johnrclem", type: "User" };
const BOT = { login: DEFAULT_AGENT_BOT_LOGIN, type: "Bot" };
const WAITING: ApprovalResult = { kind: "waiting", reason: `A2: the PR doesn't carry owner-approved` };
const APPROVED: ApprovalResult = { kind: "approved", stampedSha: "a".repeat(40) };

const file = (filename: string, status = "modified"): ChangedFile => ({ filename, status });

function gate(overrides: Partial<GateInput>) {
  return evaluateGate({
    author: OWNER,
    headPusher: OWNER,
    headRef: "claude/some-feature",
    sameRepo: true,
    files: [file("src/lib/x.ts")],
    approval: WAITING,
    ownerLogin: "johnrclem",
    agentBotLogin: DEFAULT_AGENT_BOT_LOGIN,
    ...overrides,
  });
}

describe("parsePusher", () => {
  it("reads the record-pusher description, and nothing else", () => {
    expect(parsePusher("johnrclem (User)")).toEqual({ login: "johnrclem", type: "User" });
    expect(parsePusher("hashtracks-agent[bot] (Bot)")).toEqual({ login: "hashtracks-agent[bot]", type: "Bot" });
    expect(parsePusher("Evaluating…")).toBeNull();
    expect(parsePusher(null)).toBeNull();
  });

  it("matches what the workflow writes", () => {
    expect(read(".github/workflows/write-gate.yml")).toContain(`-f context=${PUSHER_CONTEXT} -f state=success -f "description=$SENDER ($SENDER_TYPE)"`);
  });
});

describe("classify", () => {
  it.each([
    [[file("docs/ops/system.md")], "write:docs"],
    [[file("docs/kennel-onboarding/run-log.md"), file("README.md")], "write:docs"],
    // Markdown that steers agents is code, and so is anything under docs/ that isn't markdown.
    [[file("CLAUDE.md")], "write:code"],
    [[file(".claude/rules/adapter-patterns.md")], "write:code"],
    [[file("docs/kennel-onboarding/daily-onboarding-prompt.md")], "write:code"],
    [[file("docs/ops/scheduled-tasks/hashtracks-ops-digest.txt")], "write:code"],
    [[file("docs/x.md"), file("src/a.ts")], "write:code"],
    [[file("prisma/migrations/20261118_x/migration.sql", "added"), file("prisma/schema.prisma")], "write:migration"],
    // A rename out of the migrations folder still touches a migration.
    [[{ filename: "tmp/old.sql", status: "renamed", previous_filename: "prisma/migrations/1_x/migration.sql" }], "write:migration"],
    [[file(".github/workflows/ci.yml")], "write:code"],
  ] as const)("%j is %s", (files, expected) => {
    expect(classify(files)).toBe(expected);
  });
});

describe("isOnboardingData", () => {
  it.each([
    ["docs/kennel-onboarding/handoffs/2026-11-18-x.md", true],
    ["docs/kennel-onboarding/handoffs/retros/2026-11-18-x-retro.md", true],
    ["docs/kennel-onboarding/run-log.md", true],
    ["docs/kennel-onboarding/target-queue.md", true],
    ["docs/kennel-onboarding/source-platform-notes.md", true],
    ["docs/kennel-onboarding/daily-onboarding-prompt.md", false],
    ["docs/kennel-onboarding/implement-handoff-prompt.md", false],
    ["docs/kennel-onboarding/handoffs/sneaky-prompt.md", false],
    ["docs/kennel-onboarding/README.md", false],
    ["docs/ops/system.md", false],
    [".claude/settings.json", false],
    ["CLAUDE.md", false],
  ])("%s → %s", (p, expected) => {
    expect(isOnboardingData(p)).toBe(expected);
  });
});

describe("evaluateGate", () => {
  it("passes any PR with a valid owner approval, workflow edits and migrations included", () => {
    const v = gate({ author: BOT, headRef: "audit-fix/x-20261118", approval: APPROVED, files: [file(".github/workflows/ci.yml"), file("prisma/migrations/1_x/migration.sql", "added")] });
    expect(v).toMatchObject({ state: "success", path: "approval", writeClass: "write:migration" });
  });

  describe("owner-authored, low risk", () => {
    it("passes an owner branch with no migration or workflow change", () => {
      expect(gate({})).toMatchObject({ state: "success", path: "owner-authored", writeClass: "write:code" });
    });

    it.each(AGENT_BRANCH_PREFIXES)("doesn't pass an owner-authored PR on the agent prefix %s", (prefix) => {
      expect(gate({ headRef: `${prefix}x` })).toMatchObject({ state: "pending", path: null });
    });

    it("needs the stamp for a migration, even from the owner", () => {
      expect(gate({ files: [file("prisma/migrations/1_x/migration.sql", "added")] })).toMatchObject({ state: "pending", path: null });
    });

    it("fails a workflow change without approval, even from the owner", () => {
      const v = gate({ files: [file(".github/workflows/write-gate.yml")] });
      expect(v).toMatchObject({ state: "failure", path: null });
      expect(v.description).toMatch(/workflows/);
      expect(gate({ files: [file(".github/actions/setup/action.yml")] }).state).toBe("failure");
    });

    it("needs the owner to have pushed the head: a bot push onto the owner's branch needs the label", () => {
      expect(gate({ headPusher: BOT })).toMatchObject({ state: "pending", path: null });
      expect(gate({ headPusher: null })).toMatchObject({ state: "pending", path: null });
      expect(gate({ headPusher: BOT, approval: APPROVED }).path).toBe("approval");
    });

    it("doesn't treat a bot or another user named like the owner as the owner", () => {
      expect(gate({ author: { login: "johnrclem", type: "Bot" } }).path).toBeNull();
      expect(gate({ author: { login: "someone-else", type: "User" } }).path).toBeNull();
    });
  });

  describe("agent data-only", () => {
    const handoff = [file("docs/kennel-onboarding/handoffs/2026-11-18-x.md", "added"), file("docs/kennel-onboarding/run-log.md")];

    it("passes the agent bot's handoff PR", () => {
      expect(gate({ author: BOT, headRef: "onboarding/handoff-2026-11-18-x", files: handoff })).toMatchObject({ state: "success", path: "agent-data-only", writeClass: "write:docs" });
    });

    it("doesn't pass the bot's PR that also edits a manual or anything else", () => {
      for (const extra of ["docs/kennel-onboarding/daily-onboarding-prompt.md", "docs/ops/system.md", ".claude/settings.json", "CLAUDE.md", "src/a.ts"]) {
        expect(gate({ author: BOT, files: [...handoff, file(extra)] }).path).toBeNull();
      }
    });

    it("doesn't pass a rename out of the allow-list", () => {
      const renamed = { filename: "docs/kennel-onboarding/handoffs/x.md", status: "renamed", previous_filename: "docs/ops/system.md" };
      expect(gate({ author: BOT, files: [renamed] }).path).toBeNull();
    });

    it("doesn't pass the same files from another bot or the owner on an agent branch", () => {
      expect(gate({ author: { login: "dependabot[bot]", type: "Bot" }, files: handoff }).path).toBeNull();
      expect(gate({ author: OWNER, headRef: "onboarding/handoff-x", files: handoff }).path).toBeNull();
    });
  });

  it("fails a refused approval, and says why", () => {
    const v = gate({ author: BOT, approval: { kind: "refused", reason: "A2: owner-approved was last added by hashtracks-agent[bot], not the owner" } });
    expect(v.state).toBe("failure");
    expect(v.description).toMatch(/^Approval refused: A2/);
  });

  it("leaves a PR that only waits for the owner pending", () => {
    expect(gate({ author: BOT, headRef: "audit-fix/x" })).toMatchObject({ state: "pending", description: expect.stringMatching(/^Needs the owner's approval/) });
  });

  it("never passes a fork, approval or not", () => {
    expect(gate({ sameRepo: false, approval: APPROVED })).toMatchObject({ state: "failure", path: null });
  });

  it("keeps the description within GitHub's 140 characters", () => {
    expect(gate({ approval: { kind: "refused", reason: "x".repeat(300) }, author: BOT }).description.length).toBeLessThanOrEqual(140);
  });
});

describe("kept in step with the rest of the repo", () => {
  const workflow = read(".github/workflows/write-gate.yml");

  it("the workflow passes the owner login the approval module defaults to", () => {
    vi.stubEnv("OWNER_GITHUB_LOGIN", "");
    const login = ownerGithubLogin();
    vi.unstubAllEnvs();
    expect(login).toBe("johnrclem");
    expect(workflow).toMatch(new RegExp(`^\\s+OWNER_GITHUB_LOGIN: ${login}$`, "m"));
  });

  it("the workflow judges only PRs into main, and records the pusher only on push and open", () => {
    expect(workflow).toMatch(/^\s+branches: \[main\]$/m);
    expect(workflow).toContain("if: github.event.action == 'opened' || github.event.action == 'synchronize'\n");
    expect(workflow).not.toMatch(/record-pusher:[\s\S]*?reopened[\s\S]*?gate:/);
  });

    it("the workflow never checks out or runs the pull request's code", () => {
    expect(workflow).toMatch(/^\s+pull_request_target:/m);
    expect(workflow).toMatch(/^\s+ref: main$/m);
    // The PR's head SHA may name a commit status, never a checkout.
    expect(workflow).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.pull_request|github\.event\.pull_request\.head\.ref|refs\/pull\//);
    expect(workflow.match(/uses: actions\/checkout/g)).toHaveLength(1);
    expect(workflow).not.toMatch(/contents:\s*write/);
  });

  it("the agent branch prefixes are system.md's", () => {
    const fromDoc = read("docs/ops/system.md")
      .split("\n")
      .flatMap((line) => /^\| `([a-z-]+\/)` \| `hashtracks-[a-z-]+` \|/.exec(line)?.[1] ?? []);
    expect([...fromDoc].sort()).toEqual([...AGENT_BRANCH_PREFIXES].sort());
  });

  it("the handoff merge script allows exactly the onboarding data allow-list", () => {
    const script = read("scripts/onboarding-merge-handoff-pr.sh");
    const pattern = /^ALLOWED_RE='(.+)'$/m.exec(script)?.[1];
    expect(pattern).toBeDefined();
    const re = new RegExp(pattern!);
    for (const p of [
      "docs/kennel-onboarding/handoffs/2026-11-18-x.md",
      "docs/kennel-onboarding/handoffs/retros/x-retro.md",
      "docs/kennel-onboarding/run-log.md",
      "docs/kennel-onboarding/target-queue.md",
      "docs/kennel-onboarding/source-platform-notes.md",
      "docs/kennel-onboarding/daily-onboarding-prompt.md",
      "docs/kennel-onboarding/handoffs/x-prompt.md",
      "docs/kennel-onboarding/README.md",
      "docs/ops/system.md",
      "docs/kennel-onboarding/run-log.md.bak",
    ]) {
      expect([p, re.test(p) && !p.endsWith("-prompt.md")]).toEqual([p, isOnboardingData(p)]);
    }
    expect(script).toContain("-prompt.md");
  });
});
