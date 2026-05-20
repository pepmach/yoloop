import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as assert from "assert";
import { init, doctor } from "./app";
import { renderTemplate } from "./adapters";
import { pretooluse } from "./hooks";
import { readTasks } from "./io";
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
