import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CheckCommand, CheckCommandSchema } from "./schemas";
import { fail } from "./errors";

const PACKAGE_SCRIPT_CHECKS = ["build", "lint", "test", "typecheck", "check", "e2e", "integration"];

export function discoverCheckCommands(root: string): CheckCommand[] {
  return uniqueChecks([
    ...discoverPackageJsonChecks(root),
    ...discoverCargoChecks(root),
    ...discoverPythonChecks(root),
    ...discoverGoChecks(root),
  ]);
}

export function verifyCheckCommands(root: string, checks: CheckCommand[], timeoutMs: number): void {
  if (checks.length === 0) {
    console.log("verify checks: no configured or discovered checks");
    return;
  }

  for (const check of checks) {
    console.log(`verify check: ${check.name}`);
    console.log(`command: ${check.command}`);
    const output = spawnSync(check.command, {
      cwd: root,
      shell: true,
      stdio: "inherit",
      timeout: timeoutMs,
    });
    if (output.error) {
      fail(`check ${check.name} failed: ${output.error.message}`);
    }
    if (output.signal) {
      fail(`check ${check.name} terminated by signal ${output.signal}`);
    }
    if (output.status !== 0) {
      fail(`check ${check.name} exited with status ${output.status}`);
    }
    console.log(`check ${check.name}: passed`);
  }
  console.log(`verify checks: ok (${checks.length} check(s))`);
}

function discoverPackageJsonChecks(root: string): CheckCommand[] {
  const path = join(root, "package.json");
  if (!existsSync(path)) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return [];
  }

  const runner = packageRunner(root);
  const checks: CheckCommand[] = [];
  for (const name of PACKAGE_SCRIPT_CHECKS) {
    const script = (scripts as Record<string, unknown>)[name];
    if (typeof script !== "string" || script.trim() === "") {
      continue;
    }
    if (name === "test" && isPlaceholderNpmTest(script)) {
      continue;
    }
    checks.push(
      checkCommand({
        name,
        command: packageScriptCommand(runner, name),
        source: `package.json:scripts.${name}`,
      }),
    );
  }
  return checks;
}

function discoverCargoChecks(root: string): CheckCommand[] {
  if (!existsSync(join(root, "Cargo.toml"))) {
    return [];
  }
  return [
    checkCommand({ name: "cargo-build", command: "cargo build", source: "Cargo.toml" }),
    checkCommand({ name: "cargo-test", command: "cargo test", source: "Cargo.toml" }),
  ];
}

function discoverPythonChecks(root: string): CheckCommand[] {
  const pyproject = join(root, "pyproject.toml");
  if (!existsSync(pyproject)) {
    return [];
  }
  const raw = readFileSync(pyproject, "utf8").toLowerCase();
  if (!raw.includes("pytest")) {
    return [];
  }
  return [checkCommand({ name: "pytest", command: "python -m pytest", source: "pyproject.toml" })];
}

function discoverGoChecks(root: string): CheckCommand[] {
  if (!existsSync(join(root, "go.mod"))) {
    return [];
  }
  return [checkCommand({ name: "go-test", command: "go test ./...", source: "go.mod" })];
}

function packageRunner(root: string): "npm" | "pnpm" | "yarn" | "bun" {
  if (existsSync(join(root, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(root, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}

function packageScriptCommand(runner: "npm" | "pnpm" | "yarn" | "bun", script: string): string {
  if (runner === "npm") {
    return script === "test" ? "npm test" : `npm run ${script}`;
  }
  if (runner === "pnpm") {
    return script === "test" ? "pnpm test" : `pnpm ${script}`;
  }
  if (runner === "yarn") {
    return script === "test" ? "yarn test" : `yarn ${script}`;
  }
  return `bun run ${script}`;
}

function isPlaceholderNpmTest(script: string): boolean {
  return script.toLowerCase().includes("error: no test specified");
}

function uniqueChecks(checks: CheckCommand[]): CheckCommand[] {
  const seen = new Set<string>();
  const unique: CheckCommand[] = [];
  for (const check of checks) {
    if (seen.has(check.name)) {
      continue;
    }
    seen.add(check.name);
    unique.push(check);
  }
  return unique;
}

function checkCommand(value: CheckCommand): CheckCommand {
  return CheckCommandSchema.parse(value);
}
