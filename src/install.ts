import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { fail } from "./errors";

const REPOSITORY = "pepmach/yoloop";

type InstallTarget = "claude" | "codex" | "auto";

const REQUIRED_INSTALL_ARTIFACTS = [
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
  "plugins/yoloop/.claude-plugin/plugin.json",
  "plugins/yoloop/.codex-plugin/plugin.json",
  "plugins/yoloop/commands/run.md",
  "plugins/yoloop/hooks/hooks.json",
  "plugins/yoloop/skills/using-yoloop/SKILL.md",
];

export function printInstallInstructions(targetValue: string | undefined): void {
  const target = parseInstallTarget(targetValue ?? "auto");
  const packageRoot = resolve(__dirname, "..");
  validateInstallArtifacts(packageRoot);

  console.log("Yoloop plugin install");
  console.log(`package root: ${packageRoot}`);
  console.log("install mode: print instructions only; no Claude or Codex config files were changed");

  if (target === "claude" || target === "auto") {
    printClaudeInstructions();
  }
  if (target === "codex" || target === "auto") {
    printCodexInstructions();
  }
}

function parseInstallTarget(value: string): InstallTarget {
  if (value === "claude" || value === "codex" || value === "auto") {
    return value;
  }
  fail("install target must be claude, codex, or auto");
}

function validateInstallArtifacts(packageRoot: string): void {
  for (const artifact of REQUIRED_INSTALL_ARTIFACTS) {
    const fullPath = join(packageRoot, artifact);
    if (!existsSync(fullPath)) {
      fail(`missing packaged install artifact ${artifact}`);
    }
    if (artifact.endsWith(".json")) {
      parseJsonArtifact(fullPath, artifact);
    }
  }
}

function parseJsonArtifact(fullPath: string, label: string): void {
  try {
    JSON.parse(readFileSync(fullPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`invalid JSON in install artifact ${label}: ${message}`);
  }
}

function printClaudeInstructions(): void {
  console.log("");
  console.log("Claude Code");
  console.log("1. Make sure the yoloop binary is on PATH, for example npm install -g yoloop after publication.");
  console.log(`2. Add the marketplace: claude plugin marketplace add ${REPOSITORY}`);
  console.log("3. Install the plugin: claude plugin install yoloop@yoloop");
  console.log("4. Restart Claude Code, then run /yoloop:doctor inside a Yoloop project.");
  console.log("Packaged Claude plugin: plugins/yoloop/.claude-plugin/plugin.json");
  console.log("Packaged Claude marketplace: .claude-plugin/marketplace.json");
}

function printCodexInstructions(): void {
  console.log("");
  console.log("Codex");
  console.log("1. Make sure the yoloop binary is on PATH, for example npm install -g yoloop after publication.");
  console.log(`2. Add this repository as a Codex plugin marketplace: ${REPOSITORY}`);
  console.log("3. Install the yoloop plugin from the Codex Plugins UI or CLI marketplace flow.");
  console.log("4. Start a new Codex session and ask it to use the using-yoloop skill in the target repo.");
  console.log("Packaged Codex plugin: plugins/yoloop/.codex-plugin/plugin.json");
  console.log("Packaged Codex marketplace: .agents/plugins/marketplace.json");
}
