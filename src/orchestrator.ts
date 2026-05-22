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
import { emptyLogMarkdown } from "./logs";
import {
  ADAPTERS_PATH,
  CRITIC_PROMPT_PATH,
  CRITIC_VERDICTS_DIR,
  DECISIONS_PATH,
  EVENTS_PATH,
  FAILURES_PATH,
  GRAND_JURY_VERDICTS_DIR,
  GOAL_PATH,
  HUMAN_LOG_PATH,
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
  ensureDir(join(root, GRAND_JURY_VERDICTS_DIR));
  ensureDir(join(root, RAW_DIR));

  const rawContext = readRawContext(root);
  const normalized = normalizeInput(input);
  const tasks = taskLedgerFromInput(normalized.task);

  writeNew(join(root, GOAL_PATH), orchestratedGoalMarkdown(normalized, rawContext), input.force);
  writeNew(join(root, POLICY_PATH), prettyJson(defaultPolicy()), input.force);
  writeNew(join(root, ADAPTERS_PATH), prettyJson(defaultAdapters()), input.force);
  writeNew(join(root, TASKS_PATH), prettyJson(tasks), input.force);
  writeNew(join(root, PLAN_PATH), orchestratedPlanMarkdown(normalized, rawContext, tasks), input.force);
  writeNew(join(root, WORKER_PROMPT_PATH), defaultWorkerPrompt(), input.force);
  writeNew(join(root, CRITIC_PROMPT_PATH), defaultCriticPrompt(), input.force);
  writeNew(join(root, HUMAN_LOG_PATH), "", input.force);
  writeNew(join(root, PROGRESS_PATH), emptyLogMarkdown("Progress"), input.force);
  writeNew(join(root, FAILURES_PATH), emptyLogMarkdown("Failures"), input.force);
  writeNew(join(root, DECISIONS_PATH), emptyLogMarkdown("Decisions"), input.force);
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
  console.log(`accepted ${GOAL_PATH} hash: ${goalSha256}`);
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

function orchestratedGoalMarkdown(
  input: Required<Omit<OrchestratorInput, "force">>,
  rawContext: RawContextFile[],
): string {
  return `# Objective

${input.objective}

# Scope

${markdownList(input.scope)}

# Success Criteria

${markdownList(input.success)}

# Non-goals

${markdownList(input.nonGoal)}

# Human-required Gates

${markdownList(input.gate)}

# Additional Context

Read \`${RAW_DIR}/\` before planning, implementing, or judging work.

${rawContextList(rawContext)}
`;
}

function orchestratedPlanMarkdown(
  input: Required<Omit<OrchestratorInput, "force">>,
  rawContext: RawContextFile[],
  tasks: TaskLedger,
): string {
  return `# Plan

## Context

Objective: ${input.objective}

${rawContextList(rawContext)}

## Task Sequence

${tasks.tasks
  .map((task, index) => {
    const dependencies = task.dependsOn.length === 0 ? "none" : task.dependsOn.join(", ");
    return `${index + 1}. **${task.id}**: ${task.title}. Dependencies: ${dependencies}.`;
  })
  .join("\n")}

## Verification

- Each task must reach \`critic_review\` before completion.
- Each completed task requires an approved critic verdict.
- The final jury must inspect \`${GOAL_PATH}\`, \`${TASKS_PATH}\`, \`${PROGRESS_PATH}\`, \`${FAILURES_PATH}\`, \`${DECISIONS_PATH}\`, and all verdicts.
`;
}

function rawContextList(rawContext: RawContextFile[]): string {
  if (rawContext.length === 0) {
    return `No files were found in \`${RAW_DIR}/\` when the orchestrator ran.`;
  }
  return rawContext
    .map((file) => `- \`${file.path}\` (${file.bytes} bytes): ${file.preview || "no text preview"}`)
    .join("\n");
}

function markdownList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}
