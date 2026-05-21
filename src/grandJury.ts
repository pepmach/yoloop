import { existsSync } from "fs";
import { join } from "path";
import { fail } from "./errors";
import { appendEvent, ensureDir, nowIso, readJson, readTasks, writeJson } from "./io";
import { GRAND_JURY_VERDICTS_DIR } from "./paths";
import {
  GrandJuryVerdict,
  GrandJuryVerdictSchema,
  VerdictDecision,
} from "./schemas";
import { parseVerdictCheckArg } from "./verdicts";

export function writeGrandJuryVerdict(
  root: string,
  verdict: VerdictDecision,
  summary: string,
  checkArgs: string[],
  gaps: string[],
  actor: string,
): void {
  const tasksReviewed = completedRunnableTaskIds(root);
  ensureDir(join(root, GRAND_JURY_VERDICTS_DIR));

  const createdAt = nowIso();
  const verdictDoc: GrandJuryVerdict = {
    schemaVersion: 1,
    verdict,
    summary,
    checks: checkArgs.map(parseVerdictCheckArg),
    gaps,
    tasksReviewed,
    createdAt,
  };

  const timestamp = compactTimestamp(createdAt);
  const verdictPath = join(root, GRAND_JURY_VERDICTS_DIR, `final-${timestamp}.json`);
  const latestPath = latestGrandJuryVerdictPath(root);
  writeJson(verdictPath, GrandJuryVerdictSchema, verdictDoc);
  writeJson(latestPath, GrandJuryVerdictSchema, verdictDoc);

  appendEvent(root, {
    timestamp: nowIso(),
    kind: "grand_jury.verdict_written",
    actor,
    taskId: null,
    message: `Grand jury verdict: ${verdict}`,
    data: { verdict, latestPath: latestGrandJuryVerdictRelativePath() },
  });

  console.log(`wrote ${latestPath}`);
}

export function ensureGrandJuryApproved(root: string): GrandJuryVerdict {
  const verdict = readLatestGrandJuryVerdict(root);
  if (verdict.verdict !== "approved") {
    fail(`latest grand jury verdict is ${verdict.verdict}, not approved`);
  }
  return verdict;
}

export function readLatestGrandJuryVerdict(root: string): GrandJuryVerdict {
  const path = latestGrandJuryVerdictPath(root);
  if (!existsSync(path)) {
    fail(`loop cannot finish without an approved grand jury verdict: read ${path}`);
  }
  return readJson(path, GrandJuryVerdictSchema, path);
}

export function latestGrandJuryVerdictPath(root: string): string {
  return join(root, latestGrandJuryVerdictRelativePath());
}

function latestGrandJuryVerdictRelativePath(): string {
  return `${GRAND_JURY_VERDICTS_DIR}/final.latest.json`;
}

function completedRunnableTaskIds(root: string): string[] {
  const runnable = readTasks(root).tasks.filter((task) => task.status !== "cancelled");
  const incomplete = runnable.filter((task) => task.status !== "completed");
  if (incomplete.length > 0) {
    fail(`grand jury verdict requires all runnable tasks completed; incomplete: ${incomplete
      .map((task) => task.id)
      .join(", ")}`);
  }
  return runnable.map((task) => task.id);
}

function compactTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(".", "");
}
