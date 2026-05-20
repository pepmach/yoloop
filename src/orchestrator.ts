import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import {
  acceptCurrentGoalHash,
  appendEvent,
  ensureDir,
  nowIso,
  prettyJson,
  writeNew,
} from "./io";
import {
  ADAPTERS_PATH,
  CRITIC_PROMPT_PATH,
  CRITIC_VERDICTS_DIR,
  DECISIONS_PATH,
  EVENTS_PATH,
  FAILURES_PATH,
  GOAL_PATH,
  PLAN_PATH,
  POLICY_PATH,
  PROGRESS_PATH,
  RAW_DIR,
  TASKS_PATH,
  WORKER_PROMPT_PATH,
  YOLOOP_DIR,
} from "./paths";
import { TaskLedger } from "./schemas";
import {
  defaultAdapters,
  defaultCriticPrompt,
  defaultPolicy,
  defaultWorkerPrompt,
  emptyLogHtml,
} from "./templates";

export type OrchestratorInput = {
  objective: string;
  scope: string[];
  success: string[];
  nonGoal: string[];
  gate: string[];
  task: string[];
  force: boolean;
};

type RawContextFile = {
  path: string;
  bytes: number;
  preview: string;
};

export function orchestrate(root: string, input: OrchestratorInput): void {
  ensureDir(join(root, YOLOOP_DIR));
  ensureDir(join(root, CRITIC_VERDICTS_DIR));
  ensureDir(join(root, RAW_DIR));

  const rawContext = readRawContext(root);
  const normalized = normalizeInput(input);
  const tasks = taskLedgerFromInput(normalized.task);

  writeNew(join(root, GOAL_PATH), orchestratedGoalHtml(normalized, rawContext), input.force);
  writeNew(join(root, POLICY_PATH), prettyJson(defaultPolicy()), input.force);
  writeNew(join(root, ADAPTERS_PATH), prettyJson(defaultAdapters()), input.force);
  writeNew(join(root, TASKS_PATH), prettyJson(tasks), input.force);
  writeNew(join(root, PLAN_PATH), orchestratedPlanHtml(normalized, rawContext, tasks), input.force);
  writeNew(join(root, WORKER_PROMPT_PATH), defaultWorkerPrompt(), input.force);
  writeNew(join(root, CRITIC_PROMPT_PATH), defaultCriticPrompt(), input.force);
  writeNew(join(root, PROGRESS_PATH), emptyLogHtml("Progress"), input.force);
  writeNew(join(root, FAILURES_PATH), emptyLogHtml("Failures"), input.force);
  writeNew(join(root, DECISIONS_PATH), emptyLogHtml("Decisions"), input.force);
  writeNew(join(root, EVENTS_PATH), "", input.force);
  const goalSha256 = acceptCurrentGoalHash(root);

  appendEvent(root, {
    timestamp: nowIso(),
    kind: "orchestrator.artifacts_written",
    actor: "orchestrator",
    taskId: null,
    message: "Orchestrator wrote GOAL, PLAN, prompts, task ledger, policy, and adapters.",
    data: {
      taskCount: tasks.tasks.length,
      rawContextFiles: rawContext.length,
      goalSha256,
    },
  });

  console.log(`orchestrated ${tasks.tasks.length} task(s)`);
  console.log(`raw context files: ${rawContext.length}`);
  console.log(`accepted GOAL.html hash: ${goalSha256}`);
}

function normalizeInput(input: OrchestratorInput): Required<Omit<OrchestratorInput, "force">> {
  return {
    objective: input.objective.trim(),
    scope: normalizeList(input.scope, ["Implement the objective in the current repository."]),
    success: normalizeList(input.success, ["The task ledger is complete and critic-approved."]),
    nonGoal: normalizeList(input.nonGoal, ["Parallel workers are not part of this run."]),
    gate: normalizeList(input.gate, ["Ask before dependency, security-sensitive, migration, or deploy changes."]),
    task: normalizeList(input.task, [input.objective.trim() || "Implement the objective."]),
  };
}

function normalizeList(values: string[], fallback: string[]): string[] {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
}

function taskLedgerFromInput(taskTitles: string[]): TaskLedger {
  const now = nowIso();
  return {
    schemaVersion: 1,
    tasks: taskTitles.map((title, index) => ({
      id: `T-${String(index + 1).padStart(3, "0")}`,
      title,
      description: title,
      status: "pending",
      priority: (index + 1) * 100,
      attempts: 0,
      claimedBy: null,
      dependsOn: index === 0 ? [] : [`T-${String(index).padStart(3, "0")}`],
      allowedPaths: ["."],
      createdAt: now,
      updatedAt: now,
    })),
  };
}

function readRawContext(root: string): RawContextFile[] {
  const rawRoot = join(root, RAW_DIR);
  if (!existsSync(rawRoot)) {
    return [];
  }
  const files: RawContextFile[] = [];
  const stack = [rawRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        stack.push(fullPath);
      } else if (stat.isFile()) {
        const path = relative(root, fullPath).replace(/\\/g, "/");
        files.push({ path, bytes: stat.size, preview: previewFile(fullPath) });
      }
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function previewFile(path: string): string {
  const maxBytes = 2048;
  const raw = readFileSync(path);
  return raw
    .subarray(0, maxBytes)
    .toString("utf8")
    .replace(/\s+/g, " ")
    .trim();
}

function orchestratedGoalHtml(
  input: Required<Omit<OrchestratorInput, "force">>,
  rawContext: RawContextFile[],
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Yoloop Goal</title>
</head>
<body>
  <h1>Objective</h1>
  <p>${escapeHtml(input.objective)}</p>
  <h1>Scope</h1>
  ${htmlList(input.scope)}
  <h1>Success Criteria</h1>
  ${htmlList(input.success)}
  <h1>Non-goals</h1>
  ${htmlList(input.nonGoal)}
  <h1>Human-required Gates</h1>
  ${htmlList(input.gate)}
  <h1>Additional Context</h1>
  <p>Read <code>${RAW_DIR}/</code> before planning, implementing, or judging work.</p>
  ${rawContextList(rawContext)}
</body>
</html>
`;
}

function orchestratedPlanHtml(
  input: Required<Omit<OrchestratorInput, "force">>,
  rawContext: RawContextFile[],
  tasks: TaskLedger,
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Yoloop Plan</title>
</head>
<body>
  <h1>Plan</h1>
  <section id="context">
    <h2>Context</h2>
    <p>Objective: ${escapeHtml(input.objective)}</p>
    ${rawContextList(rawContext)}
  </section>
  <section id="tasks">
    <h2>Task Sequence</h2>
    <ol>
      ${tasks.tasks
        .map(
          (task) =>
            `<li><strong>${escapeHtml(task.id)}</strong>: ${escapeHtml(task.title)}. Dependencies: ${
              task.dependsOn.length === 0 ? "none" : task.dependsOn.map(escapeHtml).join(", ")
            }.</li>`,
        )
        .join("\n      ")}
    </ol>
  </section>
  <section id="verification">
    <h2>Verification</h2>
    <ul>
      <li>Each task must reach <code>critic_review</code> before completion.</li>
      <li>Each completed task requires an approved critic verdict.</li>
      <li>The final jury must inspect <code>${GOAL_PATH}</code>, <code>${TASKS_PATH}</code>, <code>${PROGRESS_PATH}</code>, <code>${FAILURES_PATH}</code>, <code>${DECISIONS_PATH}</code>, and all verdicts.</li>
    </ul>
  </section>
</body>
</html>
`;
}

function rawContextList(rawContext: RawContextFile[]): string {
  if (rawContext.length === 0) {
    return `<p>No files were found in <code>${RAW_DIR}/</code> when the orchestrator ran.</p>`;
  }
  return `<ul>
    ${rawContext
      .map(
        (file) =>
          `<li><code>${escapeHtml(file.path)}</code> (${file.bytes} bytes): ${escapeHtml(file.preview || "no text preview")}</li>`,
      )
      .join("\n    ")}
  </ul>`;
}

function htmlList(items: string[]): string {
  return `<ul>
    ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n    ")}
  </ul>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
