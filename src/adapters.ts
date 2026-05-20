import { spawnSync } from "child_process";
import { join } from "path";
import { fail } from "./errors";
import { appendEvent, atomicWriteFile, ensureDir, goalIntegrity, nowIso, readAdapters, readPolicy } from "./io";
import {
  CRITIC_PROMPT_PATH,
  DECISIONS_PATH,
  FAILURES_PATH,
  GOAL_PATH,
  PLAN_PATH,
  POLICY_PATH,
  PROGRESS_PATH,
  RAW_DIR,
  RUNS_DIR,
  TASKS_PATH,
  WORKER_PROMPT_PATH,
} from "./paths";
import { AgentAdapter, AgentRole } from "./schemas";

export function runAdapter(root: string, adapterId: string, role: AgentRole, execute: boolean): void {
  goalIntegrity(root);
  const policy = readPolicy(root);
  const { adapter, args, renderedCommand } = resolveAdapterCommand(root, adapterId, role);
  if (!execute) {
    console.log(`dry run: ${renderedCommand}`);
    return;
  }

  ensureDir(join(root, RUNS_DIR));
  const runId = `${adapter.id}-${role}-${compactTimestamp(nowIso())}-${Math.random().toString(16).slice(2, 10)}`;
  appendEvent(root, {
    timestamp: nowIso(),
    kind: "adapter.run_started",
    actor: "yoloop",
    taskId: null,
    message: `Started adapter ${adapter.id} as ${role}.`,
    data: { adapter: adapter.id, role, command: renderedCommand, runId },
  });

  const output = spawnSync(adapter.command, args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: policy.maxWallClockMinutes * 60 * 1000,
  });

  const stdoutPath = join(root, RUNS_DIR, `${runId}.stdout.txt`);
  const stderrPath = join(root, RUNS_DIR, `${runId}.stderr.txt`);
  atomicWriteFile(stdoutPath, output.stdout ?? "");
  atomicWriteFile(stderrPath, output.stderr ?? "");

  appendEvent(root, {
    timestamp: nowIso(),
    kind: "adapter.run_finished",
    actor: "yoloop",
    taskId: null,
    message: `Finished adapter ${adapter.id} as ${role}.`,
    data: {
      adapter: adapter.id,
      role,
      runId,
      exitCode: output.status,
      signal: output.signal,
      error: output.error?.message,
    },
  });

  if (output.error) {
    fail(`adapter failed: ${output.error.message}`);
  }
  if (output.status !== 0) {
    fail(`adapter exited with status ${output.status}`);
  }
}

export function resolveAdapterCommand(
  root: string,
  adapterId: string,
  role: AgentRole,
): { adapter: AgentAdapter; args: string[]; renderedCommand: string } {
  const catalog = readAdapters(root);
  const adapter = catalog.adapters.find((candidate) => candidate.id === adapterId);
  if (!adapter) {
    fail(`adapter ${adapterId} not found in ADAPTERS.json`);
  }
  const args = renderAdapterArgs(adapter, role);
  return { adapter, args, renderedCommand: formatCommand(adapter.command, args) };
}

export function renderAdapterArgs(adapter: AgentAdapter, role: AgentRole): string[] {
  const args =
    role === "worker"
      ? adapter.workerArgs
      : role === "critic"
        ? adapter.criticArgs
        : adapter.grandJuryArgs;
  return args.map(renderTemplate);
}

export function renderTemplate(value: string): string {
  return value
    .replace(/\{\{goal\}\}/g, GOAL_PATH)
    .replace(/\{\{policy\}\}/g, POLICY_PATH)
    .replace(/\{\{plan\}\}/g, PLAN_PATH)
    .replace(/\{\{tasks\}\}/g, TASKS_PATH)
    .replace(/\{\{worker_prompt\}\}/g, WORKER_PROMPT_PATH)
    .replace(/\{\{critic_prompt\}\}/g, CRITIC_PROMPT_PATH)
    .replace(/\{\{progress\}\}/g, PROGRESS_PATH)
    .replace(/\{\{failures\}\}/g, FAILURES_PATH)
    .replace(/\{\{decisions\}\}/g, DECISIONS_PATH)
    .replace(/\{\{raw\}\}/g, RAW_DIR);
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_.\\/:/-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function compactTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(".", "");
}
