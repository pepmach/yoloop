import { existsSync } from "fs";
import { join } from "path";
import { fail } from "./errors";
import { appendEvent, ensureDir, nowIso, readJson, readTasks, writeJson } from "./io";
import { CRITIC_VERDICTS_DIR } from "./paths";
import {
  CheckStatus,
  CriticVerdict,
  CriticVerdictSchema,
  VerdictCheck,
  VerdictDecision,
} from "./schemas";

export function writeCriticVerdict(
  root: string,
  taskId: string,
  verdict: VerdictDecision,
  summary: string,
  checkArgs: string[],
  gaps: string[],
  actor: string,
): void {
  ensureTaskExists(root, taskId);
  ensureDir(join(root, CRITIC_VERDICTS_DIR));

  const createdAt = nowIso();
  const verdictDoc: CriticVerdict = {
    schemaVersion: 1,
    taskId,
    verdict,
    summary,
    checks: checkArgs.map(parseVerdictCheckArg),
    gaps,
    createdAt,
  };

  const safeTaskId = safeFileId(taskId);
  const timestamp = compactTimestamp(createdAt);
  const verdictPath = join(root, CRITIC_VERDICTS_DIR, `${safeTaskId}-${timestamp}.json`);
  const latestPath = latestVerdictPath(root, taskId);
  writeJson(verdictPath, CriticVerdictSchema, verdictDoc);
  writeJson(latestPath, CriticVerdictSchema, verdictDoc);

  appendEvent(root, {
    timestamp: nowIso(),
    kind: "critic.verdict_written",
    actor,
    taskId,
    message: `Critic verdict for ${taskId}: ${verdict}`,
    data: { verdict, latestPath: latestVerdictRelativePath(taskId) },
  });

  console.log(`wrote ${latestPath}`);
}

export function ensureLatestVerdictApproved(root: string, taskId: string): void {
  const verdict = readLatestVerdict(root, taskId);
  if (verdict.taskId !== taskId) {
    fail(`latest critic verdict task mismatch: expected ${taskId}, got ${verdict.taskId}`);
  }
  if (verdict.verdict !== "approved") {
    fail(`latest critic verdict for task ${taskId} is ${verdict.verdict}, not approved`);
  }
}

export function readLatestVerdict(root: string, taskId: string): CriticVerdict {
  const path = latestVerdictPath(root, taskId);
  if (!existsSync(path)) {
    fail(`task ${taskId} cannot complete without an approved critic verdict: read ${path}`);
  }
  return readJson(path, CriticVerdictSchema, path);
}

export function parseVerdictDecision(raw: string): VerdictDecision {
  const normalized = raw.trim().toLowerCase().replace(/-/g, "_");
  const allowed: VerdictDecision[] = ["approved", "rejected", "human_approval_required"];
  if (!allowed.includes(normalized as VerdictDecision)) {
    fail(`unknown verdict ${normalized}`);
  }
  return normalized as VerdictDecision;
}

export function parseVerdictCheckArg(raw: string): VerdictCheck {
  const equals = raw.indexOf("=");
  if (equals < 0) {
    fail(`invalid check ${JSON.stringify(raw)}; expected name=status:evidence`);
  }
  const colon = raw.indexOf(":", equals + 1);
  if (colon < 0) {
    fail(`invalid check ${JSON.stringify(raw)}; expected name=status:evidence`);
  }
  return {
    name: raw.slice(0, equals).trim(),
    status: parseCheckStatus(raw.slice(equals + 1, colon)),
    evidence: raw.slice(colon + 1).trim(),
  };
}

export function latestVerdictPath(root: string, taskId: string): string {
  return join(root, latestVerdictRelativePath(taskId));
}

function latestVerdictRelativePath(taskId: string): string {
  return `${CRITIC_VERDICTS_DIR}/${safeFileId(taskId)}.latest.json`;
}

function ensureTaskExists(root: string, taskId: string): void {
  const ledger = readTasks(root);
  if (!ledger.tasks.some((task) => task.id === taskId)) {
    fail(`task ${taskId} not found`);
  }
}

function parseCheckStatus(raw: string): CheckStatus {
  const normalized = raw.trim().toLowerCase().replace(/-/g, "_");
  const allowed: CheckStatus[] = ["passed", "failed", "skipped"];
  if (!allowed.includes(normalized as CheckStatus)) {
    fail(`unknown check status ${normalized}`);
  }
  return normalized as CheckStatus;
}

function safeFileId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

function compactTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(".", "");
}
