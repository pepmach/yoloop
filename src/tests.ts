import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import * as assert from "assert";
import { init, doctor } from "./app";
import { renderTemplate } from "./adapters";
import { discoverCheckCommands, resolveCheckPlan } from "./checks";
import { pretooluse } from "./hooks";
import { readTasks } from "./io";
import { run as runCli } from "./main";
import { orchestrate } from "./orchestrator";
import { runUntilDone } from "./runner";
import { setTaskStatus } from "./tasks";
import { writeCriticVerdict } from "./verdicts";

function tempRoot(name: string): string {
  return mkdtempSync(join(tmpdir(), `yoloop-${name}-`));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok: ${name}`);
  } catch (error) {
    console.error(`not ok: ${name}`);
    throw error;
  }
}

test("init creates raw and doctor passes", () => {
  const root = tempRoot("init");
  try {
    init(root, "Test goal", true);
    assert.ok(existsSync(join(root, "GOAL.md")));
    assert.ok(existsSync(join(root, "PLAN.md")));
    assert.ok(existsSync(join(root, "WORKER_PROMPT.md")));
    assert.ok(existsSync(join(root, "CRITIC_PROMPT.md")));
    assert.ok(existsSync(join(root, "PROGRESS.md")));
    assert.ok(existsSync(join(root, "FAILURES.md")));
    assert.ok(existsSync(join(root, "DECISIONS.md")));
    assert.ok(existsSync(join(root, ".yoloop", "human-log.jsonl")));
    assert.ok(existsSync(join(root, ".yoloop", "context-manifest.json")));
    assert.equal(existsSync(join(root, "GOAL.html")), false);
    doctor(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("context refresh writes raw manifest with hashes and media types", () => {
  const root = tempRoot("context-refresh");
  try {
    init(root, "Test goal", true);
    writeFileSync(join(root, "raw", "notes.md"), "# Notes\n\nDomain context.\n", "utf8");
    writeFileSync(join(root, "raw", "config.json"), '{"feature":true}\n', "utf8");

    runCli(["context", "refresh"], root);

    const manifest = JSON.parse(readFileSync(join(root, ".yoloop", "context-manifest.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.rawDir, "raw");
    assert.deepEqual(
      manifest.files.map((file: { path: string }) => file.path),
      ["raw/config.json", "raw/notes.md"],
    );
    assert.equal(manifest.files[0].bytes, Buffer.byteLength('{"feature":true}\n'));
    assert.equal(manifest.files[0].sha256, sha256('{"feature":true}\n'));
    assert.equal(manifest.files[0].mediaType, "application/json");
    assert.equal(manifest.files[1].mediaType, "text/markdown");
    doctor(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check discovery reads package scripts without executing them", () => {
  const root = tempRoot("check-discovery");
  try {
    init(root, "Test goal", true);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify(
        {
          scripts: {
            build: "node should-not-run.cjs",
            lint: "eslint .",
            test: "node should-not-run.cjs",
            typecheck: "tsc --noEmit",
            integration: "node should-not-run.cjs",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(join(root, "package-lock.json"), "{}", "utf8");
    writeFileSync(
      join(root, "should-not-run.cjs"),
      "require('fs').writeFileSync(require('path').join(__dirname, 'ran.txt'), 'bad')",
      "utf8",
    );

    const discovered = discoverCheckCommands(root);
    assert.deepEqual(
      discovered.map((check) => check.command),
      ["npm run build", "npm run lint", "npm test", "npm run typecheck", "npm run integration"],
    );
    assert.deepEqual(
      discovered.map((check) => [check.kind, check.name, check.packageManager]),
      [
        ["build", "build", "npm"],
        ["lint", "lint", "npm"],
        ["test", "test", "npm"],
        ["typecheck", "typecheck", "npm"],
        ["integration", "integration", "npm"],
      ],
    );
    doctor(root);
    assert.equal(existsSync(join(root, "ran.txt")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check discovery detects pnpm package manager", () => {
  const root = tempRoot("pnpm-discovery");
  try {
    init(root, "Test goal", true);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { build: "vite build", test: "vitest run" } }, null, 2),
      "utf8",
    );
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");

    const discovered = discoverCheckCommands(root);
    assert.deepEqual(
      discovered.map((check) => [check.kind, check.name, check.command, check.packageManager]),
      [
        ["build", "build", "pnpm build", "pnpm"],
        ["test", "test", "pnpm test", "pnpm"],
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor rejects configured checks without command text", () => {
  const root = tempRoot("configured-checks");
  try {
    init(root, "Test goal", true);
    const policyPath = join(root, "LOOP_POLICY.json");
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    policy.checks = [{ kind: "test", name: "test", command: "", source: "user" }];
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

    assert.throws(() => doctor(root), /parse LOOP_POLICY\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor verify-checks runs configured checks", () => {
  const root = tempRoot("verify-configured-checks");
  try {
    init(root, "Test goal", true);
    writeFileSync(
      join(root, "verify-configured.cjs"),
      "require('fs').writeFileSync(require('path').join(__dirname, 'configured-ran.txt'), 'ok')",
      "utf8",
    );
    const policyPath = join(root, "LOOP_POLICY.json");
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    policy.checks = [
      {
        kind: "check",
        name: "configured",
        command: `${shellQuote(process.execPath)} ${shellQuote(join(root, "verify-configured.cjs"))}`,
        source: "test",
      },
    ];
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

    runCli(["doctor", "--verify-checks"], root);

    assert.equal(existsSync(join(root, "configured-ran.txt")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor verify-checks runs configured and discovered checks together", () => {
  const root = tempRoot("verify-merged-checks");
  try {
    init(root, "Test goal", true);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node discovered.cjs" } }, null, 2),
      "utf8",
    );
    writeFileSync(
      join(root, "discovered.cjs"),
      "require('fs').writeFileSync(require('path').join(__dirname, 'discovered-ran.txt'), 'ok')",
      "utf8",
    );
    writeFileSync(
      join(root, "configured.cjs"),
      "require('fs').writeFileSync(require('path').join(__dirname, 'configured-ran.txt'), 'ok')",
      "utf8",
    );
    const policyPath = join(root, "LOOP_POLICY.json");
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    policy.checks = [
      {
        kind: "build",
        name: "build",
        command: `${shellQuote(process.execPath)} ${shellQuote(join(root, "configured.cjs"))}`,
        source: "user",
        packageManager: "node",
      },
    ];
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

    doctor(root);
    const plan = resolveCheckPlan(root, JSON.parse(readFileSync(policyPath, "utf8")).checks);
    assert.deepEqual(
      plan.selected.map((check) => [check.kind, check.name]),
      [
        ["build", "build"],
        ["test", "test"],
      ],
    );
    assert.deepEqual(plan.packageManagers, ["node", "npm"]);
    assert.equal(existsSync(join(root, "discovered-ran.txt")), false);
    assert.equal(existsSync(join(root, "configured-ran.txt")), false);

    runCli(["doctor", "--verify-checks"], root);

    assert.equal(existsSync(join(root, "configured-ran.txt")), true);
    assert.equal(existsSync(join(root, "discovered-ran.txt")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("policy checks override discovered checks by kind and name", () => {
  const root = tempRoot("policy-overrides-discovered");
  try {
    init(root, "Test goal", true);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node discovered-should-not-run.cjs" } }, null, 2),
      "utf8",
    );
    writeFileSync(
      join(root, "discovered-should-not-run.cjs"),
      "require('fs').writeFileSync(require('path').join(__dirname, 'discovered-ran.txt'), 'bad')",
      "utf8",
    );
    writeFileSync(
      join(root, "configured-test.cjs"),
      "require('fs').writeFileSync(require('path').join(__dirname, 'configured-ran.txt'), 'ok')",
      "utf8",
    );
    const policyPath = join(root, "LOOP_POLICY.json");
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    policy.checks = [
      {
        kind: "test",
        name: "test",
        command: `${shellQuote(process.execPath)} ${shellQuote(join(root, "configured-test.cjs"))}`,
        source: "user",
      },
    ];
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

    runCli(["doctor", "--verify-checks"], root);

    assert.equal(existsSync(join(root, "configured-ran.txt")), true);
    assert.equal(existsSync(join(root, "discovered-ran.txt")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor verify-checks fails when a check exits nonzero", () => {
  const root = tempRoot("verify-failing-check");
  try {
    init(root, "Test goal", true);
    const policyPath = join(root, "LOOP_POLICY.json");
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    policy.checks = [
      {
        kind: "test",
        name: "failing",
        command: `${shellQuote(process.execPath)} -e "process.exit(7)"`,
        source: "test",
      },
    ];
    writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

    assert.throws(() => runCli(["doctor", "--verify-checks"], root), /check failing exited with status 7/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("completed task requires approved critic verdict", () => {
  const root = tempRoot("verdict");
  try {
    init(root, "Test goal", true);
    assert.throws(() => setTaskStatus(root, "T-001", "completed", "test", ""));
    writeCriticVerdict(
      root,
      "T-001",
      "rejected",
      "Not ready",
      ["npm test=passed:clean"],
      ["missing coverage"],
      "test-critic",
    );
    assert.throws(() => setTaskStatus(root, "T-001", "completed", "test", ""));
    writeCriticVerdict(root, "T-001", "approved", "Ready", ["npm test=passed:clean"], [], "test-critic");
    setTaskStatus(root, "T-001", "completed", "test", "");
    const task = readTasks(root).tasks.find((candidate) => candidate.id === "T-001");
    assert.equal(task?.status, "completed");
    assert.equal(task?.claimedBy, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("adapter template renders raw placeholder", () => {
  assert.equal(renderTemplate("read {{raw}} and {{goal}}"), "read raw and GOAL.md");
  assert.equal(
    renderTemplate("read {{context_manifest}} before {{raw}}"),
    "read .yoloop/context-manifest.json before raw",
  );
});

test("pretooluse blocks immutable goal edits", () => {
  const root = tempRoot("hook");
  try {
    init(root, "Test goal", true);
    const decision = pretooluse(
      root,
      JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "GOAL.md" } }),
    );
    assert.equal(decision.decision, "block");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pretooluse blocks changed goal for mutating tools", () => {
  const root = tempRoot("goal-hash");
  try {
    init(root, "Test goal", true);
    writeFileSync(join(root, "GOAL.md"), "changed", "utf8");
    const decision = pretooluse(root, JSON.stringify({ tool_name: "Write", tool_input: { file_path: "x.txt" } }));
    assert.equal(decision.decision, "block");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pretooluse blocks direct edits to append-only human logs", () => {
  const root = tempRoot("log-hook");
  try {
    init(root, "Test goal", true);
    const editDecision = pretooluse(
      root,
      JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "PROGRESS.md" } }),
    );
    assert.equal(editDecision.decision, "block");

    const bashDecision = pretooluse(
      root,
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "Add-Content PROGRESS.md 'raw log'" } }),
    );
    assert.equal(bashDecision.decision, "block");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("log append writes JSONL entries and renders Markdown logs", () => {
  const root = tempRoot("log-append");
  try {
    init(root, "Test goal", true);
    runCli([
      "log",
      "append",
      "--kind",
      "progress",
      "--task-id",
      "T-001",
      "--actor",
      "worker-001",
      "--summary",
      "Implemented parser guard",
      "--body",
      "Added validation before state transition.",
    ], root);

    const logJsonl = readFileSync(join(root, ".yoloop", "human-log.jsonl"), "utf8").trim().split("\n");
    assert.equal(logJsonl.length, 1);
    const entry = JSON.parse(logJsonl[0]);
    assert.equal(entry.kind, "progress");
    assert.equal(entry.taskId, "T-001");
    assert.equal(entry.actor, "worker-001");
    assert.equal(entry.summary, "Implemented parser guard");
    assert.equal(entry.body, "Added validation before state transition.");

    const progress = readFileSync(join(root, "PROGRESS.md"), "utf8");
    assert.ok(progress.includes("## Implemented parser guard"));
    assert.ok(progress.includes("Task: `T-001`"));
    assert.ok(progress.includes("worker-001"));
    assert.ok(progress.includes("Added validation before state transition."));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("orchestrator writes goal plan tasks and raw context", () => {
  const root = tempRoot("orchestrator");
  try {
    init(root, "Seed goal", true);
    writeFileSync(join(root, "raw", "context.txt"), "API notes and domain context", "utf8");
    orchestrate(root, {
      objective: "Build the orchestrator MVP",
      scope: ["Generate durable harness artifacts"],
      success: ["GOAL and PLAN mention raw context"],
      nonGoal: ["Do not launch workers"],
      gate: ["Ask before dependency changes"],
      task: ["Generate artifacts", "Verify generated artifacts"],
      force: true,
    });

    const goal = readFileSync(join(root, "GOAL.md"), "utf8");
    const plan = readFileSync(join(root, "PLAN.md"), "utf8");
    const tasks = readTasks(root);
    assert.ok(goal.includes("Build the orchestrator MVP"));
    assert.ok(goal.includes("raw/context.txt"));
    assert.ok(plan.includes("T-001"));
    assert.equal(tasks.tasks.length, 2);
    assert.equal(tasks.tasks[1].dependsOn[0], "T-001");
    assert.ok(existsSync(join(root, ".yoloop", "goal.sha256")));
    doctor(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sequential runner executes worker critic pairs until done", () => {
  const root = tempRoot("runner");
  try {
    init(root, "Loop goal", true);
    orchestrate(root, {
      objective: "Run two tasks sequentially",
      scope: [],
      success: [],
      nonGoal: [],
      gate: [],
      task: ["First task", "Second task"],
      force: true,
    });
    writeFileSync(join(root, "mock-agent.cjs"), mockAgentScript(), "utf8");
    writeFileSync(
      join(root, "ADAPTERS.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          adapters: [
            {
              id: "mock",
              label: "Mock Agent",
              command: process.execPath,
              workerArgs: [join(root, "mock-agent.cjs"), "worker"],
              criticArgs: [join(root, "mock-agent.cjs"), "critic"],
              grandJuryArgs: [join(root, "mock-agent.cjs"), "grand-jury"],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    runUntilDone(root, { adapter: "mock", dryRun: true });
    assert.equal(readTasks(root).tasks[0].status, "pending");
    runUntilDone(root, { adapter: "mock", dryRun: false });
    const tasks = readTasks(root).tasks;
    assert.equal(tasks[0].status, "completed");
    assert.equal(tasks[1].status, "completed");
    assert.ok(existsSync(join(root, ".yoloop", "grand-jury-verdicts", "final.latest.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli run executes by default and dry-run previews", () => {
  const root = tempRoot("cli-run");
  try {
    init(root, "Loop goal", true);
    orchestrate(root, {
      objective: "Run one task",
      scope: [],
      success: [],
      nonGoal: [],
      gate: [],
      task: ["Only task"],
      force: true,
    });
    const postOrchestrateManifest = JSON.parse(
      readFileSync(join(root, ".yoloop", "context-manifest.json"), "utf8"),
    );
    assert.equal(postOrchestrateManifest.files.length, 0);
    writeFileSync(join(root, "raw", "late.txt"), "late raw context\n", "utf8");
    writeFileSync(join(root, "mock-agent.cjs"), mockAgentScript(), "utf8");
    writeMockAdapter(root);

    runCli(["run", "--adapter", "mock", "--dry-run"], root);
    const postDryRunManifest = JSON.parse(readFileSync(join(root, ".yoloop", "context-manifest.json"), "utf8"));
    assert.equal(postDryRunManifest.files.length, 0);
    assert.equal(readTasks(root).tasks[0].status, "pending");
    runCli(["run", "--adapter", "mock"], root);
    const postRunManifest = JSON.parse(readFileSync(join(root, ".yoloop", "context-manifest.json"), "utf8"));
    assert.deepEqual(postRunManifest.files.map((file: { path: string }) => file.path), ["raw/late.txt"]);
    assert.equal(readTasks(root).tasks[0].status, "completed");
    assert.ok(existsSync(join(root, ".yoloop", "grand-jury-verdicts", "final.latest.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("grand jury rejection blocks loop completion", () => {
  const root = tempRoot("grand-jury-reject");
  try {
    init(root, "Loop goal", true);
    orchestrate(root, {
      objective: "Run one task",
      scope: [],
      success: [],
      nonGoal: [],
      gate: [],
      task: ["Only task"],
      force: true,
    });
    writeFileSync(join(root, "mock-agent.cjs"), mockAgentScript("rejected"), "utf8");
    writeMockAdapter(root);

    assert.throws(() => runCli(["run", "--adapter", "mock"], root), /grand jury verdict is rejected/);
    assert.equal(readTasks(root).tasks[0].status, "completed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("grand jury verdict requires all runnable tasks completed", () => {
  const root = tempRoot("grand-jury-incomplete");
  try {
    init(root, "Loop goal", true);
    assert.throws(() =>
      runCli([
        "grand-jury",
        "write-verdict",
        "--verdict",
        "approved",
        "--summary",
        "premature approval",
        "--check",
        "review=passed:ok",
      ], root),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli adapter run dry-run does not mutate task state", () => {
  const root = tempRoot("adapter-run");
  try {
    init(root, "Adapter goal", true);
    writeFileSync(join(root, "mock-agent.cjs"), mockAgentScript(), "utf8");
    writeMockAdapter(root);

    runCli(["adapter", "run", "--adapter", "mock", "--role", "worker", "--dry-run"], root);
    assert.equal(readTasks(root).tasks[0].status, "pending");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli accepts deprecated run flags with warnings", () => {
  const root = tempRoot("deprecated-run");
  try {
    init(root, "Loop goal", true);
    orchestrate(root, {
      objective: "Run one task",
      scope: [],
      success: [],
      nonGoal: [],
      gate: [],
      task: ["Only task"],
      force: true,
    });
    writeFileSync(join(root, "mock-agent.cjs"), mockAgentScript(), "utf8");
    writeMockAdapter(root);

    const warnings = captureConsoleError(() => {
      runCli(["run", "--adapter", "mock", "--until-done", "--execute"], root);
    });
    assert.ok(warnings.some((message) => message.includes("--until-done is deprecated")));
    assert.ok(warnings.some((message) => message.includes("--execute is deprecated")));
    assert.equal(readTasks(root).tasks[0].status, "completed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli accepts deprecated run role alias with warning", () => {
  const root = tempRoot("deprecated-role");
  try {
    init(root, "Adapter goal", true);
    writeFileSync(join(root, "mock-agent.cjs"), mockAgentScript(), "utf8");
    writeMockAdapter(root);

    const warnings = captureConsoleError(() => {
      runCli(["run", "--adapter", "mock", "--role", "worker", "--dry-run"], root);
    });
    assert.ok(warnings.some((message) => message.includes("yoloop run --role is deprecated")));
    assert.equal(readTasks(root).tasks[0].status, "pending");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function mockAgentScript(grandJuryVerdict = "approved"): string {
  return `
const fs = require("fs");
const path = require("path");
const role = process.argv[2];
const root = process.cwd();
const tasksPath = path.join(root, "TASKS.json");
const ledger = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
const now = new Date().toISOString();

function dependenciesCompleted(task) {
  return task.dependsOn.every((dependency) =>
    ledger.tasks.some((candidate) => candidate.id === dependency && candidate.status === "completed")
  );
}

if (role === "worker") {
  const task = ledger.tasks.find((candidate) => candidate.status === "pending" && dependenciesCompleted(candidate));
  if (!task) process.exit(2);
  task.status = "critic_review";
  task.claimedBy = "mock-worker";
  task.attempts += 1;
  task.updatedAt = now;
  fs.writeFileSync(tasksPath, JSON.stringify(ledger, null, 2) + "\\n");
  process.exit(0);
}

if (role === "critic") {
  const task = ledger.tasks.find((candidate) => candidate.status === "critic_review");
  if (!task) process.exit(3);
  const dir = path.join(root, ".yoloop", "critic-verdicts");
  fs.mkdirSync(dir, { recursive: true });
  const verdict = {
    schemaVersion: 1,
    taskId: task.id,
    verdict: "approved",
    summary: "mock approved",
    checks: [{ name: "mock", status: "passed", evidence: "ok" }],
    gaps: [],
    createdAt: now
  };
  fs.writeFileSync(path.join(dir, task.id + ".latest.json"), JSON.stringify(verdict, null, 2) + "\\n");
  process.exit(0);
}

if (role === "grand-jury") {
  const incomplete = ledger.tasks.filter((candidate) => candidate.status !== "completed" && candidate.status !== "cancelled");
  if (incomplete.length > 0) process.exit(4);
  const dir = path.join(root, ".yoloop", "grand-jury-verdicts");
  fs.mkdirSync(dir, { recursive: true });
  const verdict = {
    schemaVersion: 1,
    verdict: "${grandJuryVerdict}",
    summary: "mock final verdict",
    checks: [{ name: "final", status: "${grandJuryVerdict === "approved" ? "passed" : "failed"}", evidence: "mock inspected run" }],
    gaps: ${grandJuryVerdict === "approved" ? "[]" : '["mock unresolved gap"]'},
    tasksReviewed: ledger.tasks.filter((candidate) => candidate.status !== "cancelled").map((candidate) => candidate.id),
    createdAt: now
  };
  fs.writeFileSync(path.join(dir, "final.latest.json"), JSON.stringify(verdict, null, 2) + "\\n");
  process.exit(0);
}

process.exit(0);
`;
}

function captureConsoleError(fn: () => void): string[] {
  const original = console.error;
  const messages: string[] = [];
  console.error = (...args: unknown[]): void => {
    messages.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return messages;
}

function writeMockAdapter(root: string): void {
  writeFileSync(
    join(root, "ADAPTERS.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        adapters: [
          {
            id: "mock",
            label: "Mock Agent",
            command: process.execPath,
            workerArgs: [join(root, "mock-agent.cjs"), "worker"],
            criticArgs: [join(root, "mock-agent.cjs"), "critic"],
            grandJuryArgs: [join(root, "mock-agent.cjs"), "grand-jury"],
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function shellQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
