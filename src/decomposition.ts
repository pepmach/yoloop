import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { fail } from "./errors";
import { appendEvent, atomicWriteFile, ensureDir, nowIso, readJson, writeJson } from "./io";
import {
  DECOMPOSITION_REVIEW_PATH,
  DECOMPOSITION_VERDICTS_DIR,
  GOAL_PATH,
  PLAN_PATH,
  POLICY_PATH,
  TASKS_PATH,
} from "./paths";
import {
  DecompositionVerdict,
  DecompositionVerdictSchema,
  VerdictDecision,
} from "./schemas";
import { parseVerdictCheckArg } from "./verdicts";

export function writeDecompositionVerdict(
  root: string,
  verdict: VerdictDecision,
  summary: string,
  checkArgs: string[],
  gaps: string[],
  actor: string,
): void {
  ensureDir(join(root, DECOMPOSITION_VERDICTS_DIR));

  const createdAt = nowIso();
  const verdictDoc: DecompositionVerdict = {
    schemaVersion: 1,
    verdict,
    summary,
    checks: checkArgs.map(parseVerdictCheckArg),
    gaps,
    ...currentArtifactHashes(root),
    createdAt,
  };

  const timestamp = compactTimestamp(createdAt);
  const verdictPath = join(root, DECOMPOSITION_VERDICTS_DIR, `decomposition-${timestamp}.json`);
  const latestPath = latestDecompositionVerdictPath(root);
  writeJson(verdictPath, DecompositionVerdictSchema, verdictDoc);
  writeJson(latestPath, DecompositionVerdictSchema, verdictDoc);
  atomicWriteFile(join(root, DECOMPOSITION_REVIEW_PATH), renderDecompositionReview(verdictDoc));

  appendEvent(root, {
    timestamp: nowIso(),
    kind: "decomposition.verdict_written",
    actor,
    taskId: null,
    message: `Decomposition verdict: ${verdict}`,
    data: { verdict, latestPath: latestDecompositionVerdictRelativePath() },
  });

  console.log(`wrote ${latestPath}`);
}

export function ensureDecompositionApproved(root: string): DecompositionVerdict {
  const verdict = readLatestDecompositionVerdict(root);
  if (verdict.verdict !== "approved") {
    fail(`latest decomposition verdict is ${verdict.verdict}, not approved`);
  }
  const current = currentArtifactHashes(root);
  const mismatches = (Object.keys(current) as Array<keyof typeof current>).filter(
    (key) => verdict[key] !== current[key],
  );
  if (mismatches.length > 0) {
    fail(`approved decomposition verdict is stale for ${mismatches.join(", ")}`);
  }
  return verdict;
}

export function readLatestDecompositionVerdict(root: string): DecompositionVerdict {
  const path = latestDecompositionVerdictPath(root);
  if (!existsSync(path)) {
    fail(`worker execution requires an approved decomposition verdict: read ${path}`);
  }
  return readJson(path, DecompositionVerdictSchema, path);
}

function currentArtifactHashes(root: string): Pick<
  DecompositionVerdict,
  "goalSha256" | "planSha256" | "policySha256" | "tasksSha256"
> {
  return {
    goalSha256: fileHash(root, GOAL_PATH),
    planSha256: fileHash(root, PLAN_PATH),
    policySha256: fileHash(root, POLICY_PATH),
    tasksSha256: fileHash(root, TASKS_PATH),
  };
}

function fileHash(root: string, path: string): string {
  return createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
}

function latestDecompositionVerdictPath(root: string): string {
  return join(root, latestDecompositionVerdictRelativePath());
}

function latestDecompositionVerdictRelativePath(): string {
  return `${DECOMPOSITION_VERDICTS_DIR}/decomposition.latest.json`;
}

function renderDecompositionReview(verdict: DecompositionVerdict): string {
  const checks = verdict.checks.length === 0
    ? "- No checks recorded."
    : verdict.checks.map((check) => `- ${check.name}: ${check.status} - ${check.evidence}`).join("\n");
  const gaps = verdict.gaps.length === 0 ? "- None." : verdict.gaps.map((gap) => `- ${gap}`).join("\n");
  return `# Decomposition Review

Status: ${verdict.verdict}

${verdict.summary}

## Checks

${checks}

## Gaps

${gaps}

## Artifact Hashes

- GOAL.md: \`${verdict.goalSha256}\`
- PLAN.md: \`${verdict.planSha256}\`
- LOOP_POLICY.json: \`${verdict.policySha256}\`
- TASKS.json: \`${verdict.tasksSha256}\`
`;
}

function compactTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(".", "");
}
