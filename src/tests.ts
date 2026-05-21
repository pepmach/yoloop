import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as assert from "assert";
import { init, doctor } from "./app";
import { renderTemplate } from "./adapters";
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
    doctor(root);
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
  assert.equal(renderTemplate("read {{raw}} and {{goal}}"), "read raw and GOAL.html");
});

test("pretooluse blocks immutable goal edits", () => {
  const root = tempRoot("hook");
  try {
    init(root, "Test goal", true);
    const decision = pretooluse(
      root,
      JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "GOAL.html" } }),
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
    writeFileSync(join(root, "GOAL.html"), "changed", "utf8");
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
      JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "PROGRESS.html" } }),
    );
    assert.equal(editDecision.decision, "block");

    const bashDecision = pretooluse(
      root,
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "Add-Content PROGRESS.html 'raw log'" } }),
    );
    assert.equal(bashDecision.decision, "block");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("log append writes curated HTML entries", () => {
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

    const progress = readFileSync(join(root, "PROGRESS.html"), "utf8");
    assert.ok(progress.includes('<article class="yoloop-log-entry" data-kind="progress"'));
    assert.ok(progress.includes("<h2>Implemented parser guard</h2>"));
    assert.ok(progress.includes("<code>T-001</code>"));
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

    const goal = readFileSync(join(root, "GOAL.html"), "utf8");
    const plan = readFileSync(join(root, "PLAN.html"), "utf8");
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
    writeFileSync(join(root, "mock-agent.cjs"), mockAgentScript(), "utf8");
    writeMockAdapter(root);

    runCli(["run", "--adapter", "mock", "--dry-run"], root);
    assert.equal(readTasks(root).tasks[0].status, "pending");
    runCli(["run", "--adapter", "mock"], root);
    assert.equal(readTasks(root).tasks[0].status, "completed");
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

function mockAgentScript(): string {
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
