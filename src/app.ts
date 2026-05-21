import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { fail } from "./errors";
import { readLatestGrandJuryVerdict } from "./grandJury";
import {
  appendEvent,
  atomicWriteFile,
  ensureDir,
  goalHash,
  goalIntegrity,
  nowIso,
  prettyJson,
  readAdapters,
  readPolicy,
  readTasks,
  writeJson,
  writeNew,
} from "./io";
import {
  ADAPTERS_PATH,
  CRITIC_PROMPT_PATH,
  CRITIC_VERDICTS_DIR,
  DECISIONS_PATH,
  EVENTS_PATH,
  FAILURES_PATH,
  GRAND_JURY_VERDICTS_DIR,
  GOAL_HASH_PATH,
  GOAL_PATH,
  PLAN_PATH,
  POLICY_PATH,
  PROGRESS_PATH,
  RAW_DIR,
  TASKS_PATH,
  WORKER_PROMPT_PATH,
  YOLOOP_DIR,
} from "./paths";
import { LoopPolicySchema } from "./schemas";
import {
  defaultAdapters,
  defaultCriticPrompt,
  defaultPlan,
  defaultPolicy,
  defaultTasks,
  defaultWorkerPrompt,
  emptyLogHtml,
  goalHtml,
} from "./templates";
import { nextClaimableTask } from "./tasks";

export function init(root: string, goal: string | undefined, force: boolean): void {
  ensureDir(join(root, YOLOOP_DIR));
  ensureDir(join(root, CRITIC_VERDICTS_DIR));
  ensureDir(join(root, GRAND_JURY_VERDICTS_DIR));
  ensureDir(join(root, RAW_DIR));

  const objective = goal ?? "Describe the goal here before launching the loop.";
  writeNew(join(root, GOAL_PATH), goalHtml(objective), force);
  writeNew(join(root, POLICY_PATH), prettyJson(defaultPolicy()), force);
  writeNew(join(root, TASKS_PATH), prettyJson(defaultTasks()), force);
  writeNew(join(root, ADAPTERS_PATH), prettyJson(defaultAdapters()), force);
  writeNew(join(root, PLAN_PATH), defaultPlan(), force);
  writeNew(join(root, WORKER_PROMPT_PATH), defaultWorkerPrompt(), force);
  writeNew(join(root, CRITIC_PROMPT_PATH), defaultCriticPrompt(), force);
  writeNew(join(root, PROGRESS_PATH), emptyLogHtml("Progress"), force);
  writeNew(join(root, FAILURES_PATH), emptyLogHtml("Failures"), force);
  writeNew(join(root, DECISIONS_PATH), emptyLogHtml("Decisions"), force);
  writeNew(join(root, EVENTS_PATH), "", force);

  if (force || !existsSync(join(root, GOAL_HASH_PATH))) {
    atomicWriteFile(join(root, GOAL_HASH_PATH), `${goalHash(root)}\n`);
  }

  appendEvent(root, {
    timestamp: nowIso(),
    kind: "harness.initialized",
    actor: "yoloop",
    taskId: null,
    message: "Initialized Yoloop harness files.",
    data: { rawDir: RAW_DIR },
  });

  console.log(`initialized yoloop in ${root}`);
  console.log(`put supporting context in ${join(root, RAW_DIR)}`);
  console.log("edit GOAL.html, PLAN.html, TASKS.json, and LOOP_POLICY.json before launching agents");
}

export function status(root: string): void {
  const policy = readPolicy(root);
  const ledger = readTasks(root);
  let goalStatus = "hash matches";
  let grandJuryStatus = "none";
  try {
    goalStatus = goalIntegrity(root);
  } catch (error) {
    goalStatus = `FAILED: ${formatError(error)}`;
  }
  try {
    const verdict = readLatestGrandJuryVerdict(root);
    grandJuryStatus = `${verdict.verdict}: ${verdict.summary}`;
  } catch {
    grandJuryStatus = "none";
  }

  const counts = {
    pending: 0,
    in_progress: 0,
    critic_review: 0,
    completed: 0,
    blocked: 0,
    cancelled: 0,
  };
  for (const task of ledger.tasks) {
    counts[task.status] += 1;
  }

  console.log(`active: ${policy.active}`);
  console.log(`goal: ${goalStatus}`);
  console.log(`grand jury: ${grandJuryStatus}`);
  console.log(`raw context files: ${rawContextFileCount(root)}`);
  console.log(`tasks: ${ledger.tasks.length} total`);
  console.log(`  pending: ${counts.pending}`);
  console.log(`  in_progress: ${counts.in_progress}`);
  console.log(`  critic_review: ${counts.critic_review}`);
  console.log(`  completed: ${counts.completed}`);
  console.log(`  blocked: ${counts.blocked}`);
  console.log(`  cancelled: ${counts.cancelled}`);

  const next = nextClaimableTask(ledger);
  if (next) {
    console.log(`next claimable task: ${next.id} - ${next.title}`);
  } else {
    console.log("next claimable task: none");
  }
}

export function doctor(root: string): void {
  const requiredFiles = [
    GOAL_PATH,
    GOAL_HASH_PATH,
    POLICY_PATH,
    TASKS_PATH,
    ADAPTERS_PATH,
    PLAN_PATH,
    WORKER_PROMPT_PATH,
    CRITIC_PROMPT_PATH,
    PROGRESS_PATH,
    FAILURES_PATH,
    DECISIONS_PATH,
    EVENTS_PATH,
  ];
  const requiredDirs = [YOLOOP_DIR, RAW_DIR, CRITIC_VERDICTS_DIR, GRAND_JURY_VERDICTS_DIR];

  for (const path of requiredDirs) {
    const fullPath = join(root, path);
    if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) {
      fail(`missing required directory ${fullPath}`);
    }
  }
  for (const path of requiredFiles) {
    const fullPath = join(root, path);
    if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
      fail(`missing required file ${fullPath}`);
    }
  }

  readPolicy(root);
  readTasks(root);
  readAdapters(root);
  goalIntegrity(root);

  console.log("doctor: ok");
  console.log(`raw context files: ${rawContextFileCount(root)}`);
}

export function setActive(root: string, active: boolean, actor: string): void {
  const policy = readPolicy(root);
  policy.active = active;
  writeJson(join(root, POLICY_PATH), LoopPolicySchema, policy);
  appendEvent(root, {
    timestamp: nowIso(),
    kind: active ? "policy.resumed" : "policy.paused",
    actor,
    taskId: null,
    message: active ? "Loop policy resumed." : "Loop policy paused.",
    data: {},
  });
  console.log(`active: ${active}`);
}

export function acceptGoal(root: string, actor: string): void {
  const hash = goalHash(root);
  atomicWriteFile(join(root, GOAL_HASH_PATH), `${hash}\n`);
  appendEvent(root, {
    timestamp: nowIso(),
    kind: "goal.accepted",
    actor,
    taskId: null,
    message: "Accepted current GOAL.html hash.",
    data: { goalSha256: hash },
  });
  console.log("accepted GOAL.html");
}

function rawContextFileCount(root: string): number {
  const rawPath = join(root, RAW_DIR);
  if (!existsSync(rawPath)) {
    return 0;
  }
  let count = 0;
  const stack = [rawPath];
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
        count += 1;
      }
    }
  }
  return count;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
