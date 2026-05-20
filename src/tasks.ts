import { join } from "path";
import { fail } from "./errors";
import { appendEvent, goalIntegrity, nowIso, readPolicy, readTasks, writeJson } from "./io";
import { TASKS_PATH } from "./paths";
import { Task, TaskLedger, TaskLedgerSchema, TaskStatus } from "./schemas";
import { ensureLatestVerdictApproved } from "./verdicts";

export function claimNext(root: string, worker: string): void {
  const policy = readPolicy(root);
  if (!policy.active) {
    fail("loop is paused; resume before claiming work");
  }
  goalIntegrity(root);

  const ledger = readTasks(root);
  const index = nextClaimableTaskIndex(ledger, policy.maxRetriesPerTask);
  if (index === undefined) {
    console.log("no claimable task");
    return;
  }

  const task = ledger.tasks[index];
  task.status = "in_progress";
  task.claimedBy = worker;
  task.attempts += 1;
  task.updatedAt = nowIso();
  writeJson(join(root, TASKS_PATH), TaskLedgerSchema, ledger);

  appendEvent(root, {
    timestamp: nowIso(),
    kind: "task.claimed",
    actor: worker,
    taskId: task.id,
    message: `Claimed task ${task.id}.`,
    data: { worker },
  });

  console.log(`claimed ${task.id}: ${task.title}`);
}

export function setTaskStatus(
  root: string,
  id: string,
  rawStatus: string,
  actor: string,
  message: string,
): void {
  const nextStatus = parseTaskStatus(rawStatus);
  if (nextStatus === "completed") {
    ensureLatestVerdictApproved(root, id);
  }

  const ledger = readTasks(root);
  const task = ledger.tasks.find((candidate) => candidate.id === id);
  if (!task) {
    fail(`task ${id} not found`);
  }

  task.status = nextStatus;
  task.updatedAt = nowIso();
  if (["pending", "completed", "cancelled", "blocked"].includes(nextStatus)) {
    task.claimedBy = null;
  } else if (!task.claimedBy) {
    task.claimedBy = actor;
  }

  writeJson(join(root, TASKS_PATH), TaskLedgerSchema, ledger);
  appendEvent(root, {
    timestamp: nowIso(),
    kind: "task.status_changed",
    actor,
    taskId: id,
    message: message || `Set task ${id} to ${nextStatus}.`,
    data: { status: nextStatus },
  });
  console.log(`task ${id}: ${nextStatus}`);
}

export function ensureTaskExists(root: string, id: string): void {
  const ledger = readTasks(root);
  if (!ledger.tasks.some((task) => task.id === id)) {
    fail(`task ${id} not found`);
  }
}

export function nextClaimableTask(ledger: TaskLedger): Task | undefined {
  const index = nextClaimableTaskIndex(ledger, Number.MAX_SAFE_INTEGER);
  return index === undefined ? undefined : ledger.tasks[index];
}

function nextClaimableTaskIndex(ledger: TaskLedger, maxRetriesPerTask: number): number | undefined {
  let bestIndex: number | undefined;
  for (let index = 0; index < ledger.tasks.length; index += 1) {
    const task = ledger.tasks[index];
    if (
      task.status !== "pending" ||
      task.attempts >= maxRetriesPerTask ||
      !dependenciesCompleted(ledger, task)
    ) {
      continue;
    }
    if (bestIndex === undefined || task.priority < ledger.tasks[bestIndex].priority) {
      bestIndex = index;
    }
  }
  return bestIndex;
}

function dependenciesCompleted(ledger: TaskLedger, task: Task): boolean {
  return task.dependsOn.every((dependency) =>
    ledger.tasks.some((candidate) => candidate.id === dependency && candidate.status === "completed"),
  );
}

function parseTaskStatus(status: string): TaskStatus {
  const normalized = status.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "canceled") {
    return "cancelled";
  }
  const allowed: TaskStatus[] = [
    "pending",
    "in_progress",
    "critic_review",
    "completed",
    "cancelled",
    "blocked",
  ];
  if (!allowed.includes(normalized as TaskStatus)) {
    fail(`unknown task status ${normalized}`);
  }
  return normalized as TaskStatus;
}
