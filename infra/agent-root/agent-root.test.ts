/**
 * The agent root's scripts fail closed, and its settings keep the speed bumps (docs/ops/system.md#identity).
 * Runs the real shell scripts in a scratch folder with no config, so nothing reaches GitHub.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(path.join(HERE, file), "utf8");

function scratchRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "agent-root-"));
  mkdirSync(path.join(root, "bin"));
  cpSync(path.join(HERE, "bin"), path.join(root, "bin"), { recursive: true });
  symlinkSync("agent-gh.sh", path.join(root, "bin", "gh"));
  return root;
}

describe("the gh shim", () => {
  it.each([
    [["api", "user", "--jq", ".login"]],
    [["pr", "list"]],
    [["auth", "git-credential", "get"]],
  ])("runs nothing and prints nothing when it can't mint a token (gh %j)", (args) => {
    const root = scratchRoot();
    const run = spawnSync("bash", [path.join(root, "bin", "gh"), ...args], { encoding: "utf8", input: "" });
    expect(run.status).toBe(97);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/couldn't mint a HashTracks Agent token/);
  });
});

describe("check-root.sh", () => {
  it("reports drift, not OK, for a root with no settings", () => {
    const root = scratchRoot();
    const run = spawnSync("bash", [path.join(root, "bin", "check-root.sh"), path.join(HERE, "../../.claude/settings.json")], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/^root-settings: DRIFT: .*settings\.local\.json is missing/);
  });
});

describe("settings.extra.json", () => {
  const extra = JSON.parse(read("settings.extra.json")) as { permissions: { allow: string[]; deny: string[] } };

  it("denies the ways around the shim", () => {
    for (const rule of ["Bash(*GH_CONFIG_DIR=*)", "Bash(*GITHUB_TOKEN=*)", "Bash(*GH_TOKEN=*)", "Bash(/opt/homebrew/bin/gh*)", "Bash(gh auth token*)", "Bash(gh auth login*)"]) {
      expect(extra.permissions.deny).toContain(rule);
    }
  });

  it("allows nothing the repo's settings deny", () => {
    const repo = JSON.parse(readFileSync(path.join(HERE, "../../.claude/settings.json"), "utf8")) as { permissions: { deny: string[] } };
    for (const rule of repo.permissions.deny) expect(extra.permissions.allow).not.toContain(rule);
  });
});
