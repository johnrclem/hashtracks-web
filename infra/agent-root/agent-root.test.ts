/**
 * The agent root's scripts fail closed, and its settings keep the speed bumps (docs/ops/system.md#identity).
 * Runs the real shell scripts in a scratch folder with no config, so nothing reaches GitHub.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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

/** A scratch root whose minter and real gh are stubs: no network, no App. */
function stubbedRoot(): { root: string; ghLog: string } {
  const root = scratchRoot();
  mkdirSync(path.join(root, ".agent"));
  const ghLog = path.join(root, "gh.log");
  const stubMint = path.join(root, "bin", "mint-token.sh");
  writeFileSync(stubMint, '#!/usr/bin/env bash\necho ghs_stub_token\n');
  chmodSync(stubMint, 0o755);
  const realGh = path.join(root, "real-gh");
  writeFileSync(realGh, `#!/usr/bin/env bash\necho "token=$GH_TOKEN args=$*" >> ${JSON.stringify(ghLog)}\n`);
  chmodSync(realGh, 0o755);
  writeFileSync(path.join(root, ".agent", "config"), `REAL_GH=${realGh}\nBOT_LOGIN=hashtracks-agent[bot]\n`);
  return { root, ghLog };
}

describe("the gh shim, when it can mint", () => {
  const run = (root: string, args: string[], input = "") =>
    spawnSync("bash", [path.join(root, "bin", "gh"), ...args], { encoding: "utf8", input });

  it.each([
    [["api", "user", "--jq", ".login"]],
    [["api", "user", "-q", ".login"]],
    [["api", "user", "--jq=.login"]],
    [["api", "--jq", ".login", "user"]],
    [["api", "/user", "--jq", ".login"]],
  ])("answers the preflight's `gh %j` with the bot login", (args) => {
    const { root } = stubbedRoot();
    expect(run(root, args)).toMatchObject({ status: 0, stdout: "hashtracks-agent[bot]\n" });
  });

  it("answers a bare `gh api user` with JSON", () => {
    const { root } = stubbedRoot();
    expect(JSON.parse(run(root, ["api", "user"]).stdout)).toEqual({ login: "hashtracks-agent[bot]", type: "Bot" });
  });

  it("gives git the minted token as a credential, and nothing for store or erase", () => {
    const { root } = stubbedRoot();
    expect(run(root, ["auth", "git-credential", "get"], "protocol=https\nhost=github.com\n\n").stdout).toBe(
      "protocol=https\nhost=github.com\nusername=x-access-token\npassword=ghs_stub_token\n",
    );
    expect(run(root, ["auth", "git-credential", "store"], "x\n")).toMatchObject({ status: 0, stdout: "" });
  });

  it("runs the real gh with the minted token for everything else", () => {
    const { root, ghLog } = stubbedRoot();
    expect(run(root, ["pr", "list"]).status).toBe(0);
    expect(readFileSync(ghLog, "utf8")).toBe("token=ghs_stub_token args=pr list\n");
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
    for (const rule of ["Bash(*GH_CONFIG_DIR=*)", "Bash(*GITHUB_TOKEN=*)", "Bash(*GH_TOKEN=*)", "Bash(/opt/homebrew/bin/gh*)", "Bash(gh auth token*)", "Bash(gh auth login*)", "Bash(*.agent/*)", "Bash(*.agent)"]) {
      expect(extra.permissions.deny).toContain(rule);
    }
  });

  it("allows nothing the repo's settings deny", () => {
    const repo = JSON.parse(readFileSync(path.join(HERE, "../../.claude/settings.json"), "utf8")) as { permissions: { deny: string[] } };
    for (const rule of repo.permissions.deny) expect(extra.permissions.allow).not.toContain(rule);
  });
});
