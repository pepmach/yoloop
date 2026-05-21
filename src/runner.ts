import { fail } from "./errors";
import { appendEvent, goalIntegrity, nowIso, readPolicy, readTasks } from "./io";
import { resolveAdapterCommand, runAdapter } from "./adapters";
import { Task, TaskStatus } from "./schemas";
import { nextClaimableTask, setTaskStatus } from "./tasks";
import { readLatestVerdict } from "./verdicts";

export type SequentialRunOptions = {
  adapter: string;
  dryRun: boolean;
};

export function runUntilDone(root: string, options: SequentialRunOptions): void {
  goalIntegrity(root);
  const policy = readPolicy(root);
  if (!policy.active) {
    fail("loop is paused; resume before running until done");
  }

  if (options.dryRun) {
    dryRunSequentialLoop(root, options.adapter);
    return;
  }

  appendEvent(root, {
    timestamp: nowIso(),
    kind: "loop.started",
    actor: "yoloop-runner",
    taskId: null,
    message: "Started sequential worker-critic loop.",
    data: { adapter: options.adapter, maxIterations: policy.maxIterations },
  });

  for (let iteration = 1; iteration <= policy.maxIterations; iteration += 1) {
    const ledger = readTasks(root);
    if (allRunnableTasksCompleted(ledger.tasks)) {
      appendEvent(root, {
        timestamp: nowIso(),
        kind: "loop.completed",
        actor: "yoloop-runner",
        taskId: null,
        message: "Sequential worker-critic loop completed all tasks.",
        data: { iteration },
      });
      console.log("<yoloop-done>");
      return;
    }

    const task = nextClaimableTask(ledger, policy.maxRetriesPerTask);
    if (!task) {
      fail("no claimable pending task; loop cannot continue");
    }

    console.log(`iteration ${iteration}: worker starting ${task.id}`);
    runAdapter(root, options.adapter, "worker", false);
    assertTaskStatus(root, task.id, "critic_review", "worker must leave task in critic_review");

    console.log(`iteration ${iteration}: critic reviewing ${task.id}`);
    runAdapter(root, options.adapter, "critic", false);

    const verdict = readLatestVerdict(root, task.id);
    if (verdict.verdict === "approved") {
      setTaskStatus(root, task.id, "completed", "yoloop-runner", "Completed after approved critic verdict.");
      continue;
    }

    if (verdict.verdict === "human_approval_required") {
      setTaskStatus(root, task.id, "blocked", "yoloop-runner", "Blocked by human-approval-required critic verdict.");
      fail(`task ${task.id} requires human approval`);
    }

    const latest = readTasks(root).tasks.find((candidate) => candidate.id === task.id);
    if (!latest) {
      fail(`task ${task.id} disappeared after critic verdict`);
    }
    if (latest.attempts >= policy.maxRetriesPerTask) {
      setTaskStatus(root, task.id, "blocked", "yoloop-runner", "Blocked after retry budget was exhausted.");
      fail(`task ${task.id} rejected and retry budget exhausted`);
    }
    setTaskStatus(root, task.id, "pending", "yoloop-runner", "Critic rejected; queued repair attempt.");
  }

  fail(`loop exceeded maxIterations ${policy.maxIterations}`);
}

function dryRunSequentialLoop(root: string, adapterId: string): void {
  const policy = readPolicy(root);
  const ledger = readTasks(root);
  const task = nextClaimableTask(ledger, policy.maxRetriesPerTask);
  if (!task) {
    console.log("dry run: no claimable pending task");
    return;
  }
  const worker = resolveAdapterCommand(root, adapterId, "worker");
  const critic = resolveAdapterCommand(root, adapterId, "critic");
  console.log(`dry run: sequential loop would start with ${task.id} - ${task.title}`);
  console.log(`dry run worker: ${worker.renderedCommand}`);
  console.log(`dry run critic: ${critic.renderedCommand}`);
  console.log("dry run only; run without --dry-run to execute");
}

function assertTaskStatus(root: string, taskId: string, expected: TaskStatus, message: string): void {
  const task = readTasks(root).tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    fail(`task ${taskId} disappeared`);
  }
  if (task.status !== expected) {
    fail(`${message}; expected ${expected}, got ${task.status}`);
  }
}

function allRunnableTasksCompleted(tasks: Task[]): boolean {
  return tasks
    .filter((task) => task.status !== "cancelled")
    .every((task) => task.status === "completed");
}
