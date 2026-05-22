import {
  CONTEXT_MANIFEST_PATH,
  DECOMPOSITION_REVIEW_PATH,
  DECISIONS_PATH,
  FAILURES_PATH,
  GOAL_HASH_PATH,
  GOAL_PATH,
  HUMAN_LOG_PATH,
  PLAN_PATH,
  POLICY_PATH,
  PROGRESS_PATH,
  RAW_DIR,
  TASKS_PATH,
} from "./paths";
import { AdapterCatalog, LoopPolicy, TaskLedger } from "./schemas";
import { nowIso } from "./io";

export function defaultPolicy(): LoopPolicy {
  return {
    schemaVersion: 1,
    active: true,
    maxIterations: 50,
    maxWallClockMinutes: 480,
    maxRetriesPerTask: 3,
    immutablePaths: [GOAL_PATH, GOAL_HASH_PATH],
    protectedPathsWhileActive: [POLICY_PATH, HUMAN_LOG_PATH, PROGRESS_PATH, FAILURES_PATH, DECISIONS_PATH],
    allowedWriteRoots: ["."],
    denyShellSubstrings: [
      "git reset --hard",
      "git checkout --",
      "rm -rf",
      "remove-item -recurse",
      "format-volume",
    ],
    humanGates: [
      {
        id: "dependency-change",
        description:
          "Changing lockfiles or package manifests requires human approval unless the task explicitly allows it.",
        pathGlobs: [
          "package-lock.json",
          "pnpm-lock.yaml",
          "yarn.lock",
          "package.json",
          "Cargo.lock",
          "Cargo.toml",
        ],
        commandSubstrings: ["npm install", "pnpm add", "cargo add"],
      },
      {
        id: "security-sensitive",
        description:
          "Auth, permissions, secrets, migrations, and production deploy changes require explicit human approval.",
        pathGlobs: [".env", "migrations/", "auth/", "permissions/"],
        commandSubstrings: ["deploy", "migration"],
      },
    ],
    checks: [],
  };
}

export function defaultAdapters(): AdapterCatalog {
  return {
    schemaVersion: 1,
    adapters: [
      {
        id: "claude-code",
        label: "Claude Code",
        command: "claude",
        decompositionArgs: [
          "-p",
          "Read {{goal}}, {{plan}}, {{policy}}, {{tasks}}, and {{context_manifest}}. Review whether the task ledger is executable: milestones, success criteria, dependencies, allowed paths, risk, checks, gates, non-goals, and raw context. Write the verdict with yoloop decomposition write-verdict.",
        ],
        workerArgs: [
          "-p",
          `Read {{worker_prompt}} first, inspect {{context_manifest}} and ${RAW_DIR}/ for extra context, then claim and execute exactly one pending task from {{tasks}}. Treat {{goal}}, {{policy}}, and {{plan}} as authoritative.`,
        ],
        criticArgs: [
          "-p",
          "Read {{critic_prompt}} first, inspect the current diff, run available checks, and write a verdict with yoloop critic write-verdict.",
        ],
        grandJuryArgs: [
          "-p",
          "Read {{goal}}, {{plan}}, {{tasks}}, {{decomposition_review}}, {{context_manifest}}, {{progress}}, {{failures}}, {{decisions}}, raw/ context, and all critic verdicts. Approve only if the entire run is complete and clean. Write the final verdict with yoloop grand-jury write-verdict.",
        ],
      },
      {
        id: "codex-cli",
        label: "Codex CLI",
        command: "codex",
        decompositionArgs: [
          "exec",
          "Read {{goal}}, {{plan}}, {{policy}}, {{tasks}}, and {{context_manifest}}. Review whether the task ledger is executable: milestones, success criteria, dependencies, allowed paths, risk, checks, gates, non-goals, and raw context. Write the verdict with yoloop decomposition write-verdict.",
        ],
        workerArgs: [
          "exec",
          `Read {{worker_prompt}} first, inspect {{context_manifest}} and ${RAW_DIR}/ for extra context, then claim and execute exactly one pending task from {{tasks}}. Treat {{goal}}, {{policy}}, and {{plan}} as authoritative.`,
        ],
        criticArgs: [
          "exec",
          "Read {{critic_prompt}} first, inspect the current diff, run available checks, and write a verdict with yoloop critic write-verdict.",
        ],
        grandJuryArgs: [
          "exec",
          "Read {{goal}}, {{plan}}, {{tasks}}, {{decomposition_review}}, {{context_manifest}}, {{progress}}, {{failures}}, {{decisions}}, raw/ context, and all critic verdicts. Approve only if the entire run is complete and clean. Write the final verdict with yoloop grand-jury write-verdict.",
        ],
      },
    ],
  };
}

export function defaultTasks(): TaskLedger {
  const now = nowIso();
  return {
    schemaVersion: 1,
    milestones: [
      {
        id: "M-001",
        title: "Initial implementation milestone",
        description: "Replace this seed milestone with a concrete milestone plan before launching workers.",
        taskIds: ["T-001"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    tasks: [
      {
        id: "T-001",
        milestoneId: "M-001",
        title: "Replace this seed task with the first implementation slice",
        description: "Describe the smallest useful task the first worker should complete.",
        successCriteria: ["The task has concrete implementation and verification criteria."],
        status: "pending",
        priority: 100,
        risk: "medium",
        attempts: 0,
        claimedBy: null,
        dependsOn: [],
        allowedPaths: ["."],
        checks: ["doctor"],
        gates: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export function defaultPlan(): string {
  return `# Plan

## Phase 1: Foundation

- Read \`${RAW_DIR}/\` for user-provided context before decomposing work.
- Convert \`${GOAL_PATH}\` into scoped tasks.
- Keep each task small enough for one fresh worker session.
- Require critic approval before marking a task complete.

## Phase 2: Implementation

- Worker claims one pending task from \`${TASKS_PATH}\`.
- Worker appends curated entries to \`${PROGRESS_PATH}\`, \`${FAILURES_PATH}\`, and \`${DECISIONS_PATH}\` through \`yoloop log append\` at state transitions.
- Worker hands off to critic when implementation and local verification are complete.

## Phase 3: Verification

- Critic runs deterministic checks first.
- Critic performs gap analysis against \`${GOAL_PATH}\`, \`${PLAN_PATH}\`, and the task contract.
- Critic writes a verdict with \`yoloop critic write-verdict\`.

## Phase 4: Final Jury

- Grand jury verifies all tasks are complete.
- Grand jury checks for unacknowledged side effects and unresolved failures.
- Grand jury writes a structured final verdict with \`yoloop grand-jury write-verdict\`.
- Harness emits \`<yoloop-done>\` only after the final jury passes.
`;
}

export function defaultWorkerPrompt(): string {
  return `# Worker Prompt

You are the worker in a Yoloop harness. You run as a fresh one-shot role session, so start from the durable artifacts instead of relying on prior chat history.

## Read First

- \`${GOAL_PATH}\`: immutable human objective and success criteria.
- \`${POLICY_PATH}\`: budgets, protected files, and human approval gates.
- \`${PLAN_PATH}\`: implementation plan.
- \`${DECOMPOSITION_REVIEW_PATH}\`: decomposition critic result. Workers must not start if this is missing, stale, or rejected.
- \`${TASKS_PATH}\`: source of truth for task status and ownership.
- \`${CONTEXT_MANIFEST_PATH}\`: manifest of files currently under \`${RAW_DIR}/\`.
- \`${PROGRESS_PATH}\`: rendered progress log. Append with \`yoloop log append --kind progress\`; do not edit directly.
- \`${FAILURES_PATH}\`: rendered failure memory. Append with \`yoloop log append --kind failure\`; do not edit directly.
- \`${DECISIONS_PATH}\`: rendered decision log. Append with \`yoloop log append --kind decision\`; do not edit directly.
- \`${RAW_DIR}/\`: user-supplied product notes, repo context, references, and domain knowledge.

## Protocol

1. Claim exactly one pending task.
2. Verify the task contract includes milestone, success criteria, checks, allowed paths, risk, dependencies, and gates.
3. Survey relevant repo context and \`${RAW_DIR}/\` before editing.
4. Append a progress entry at meaningful state transitions with \`yoloop log append --kind progress --task-id T-001 --summary "..." --body "..."\`.
5. Append a failure entry after every failed test, build, rejected approach, or critic rejection with \`yoloop log append --kind failure --task-id T-001 --summary "..." --body "..."\`.
6. Append a decision entry for important implementation choices that do not require human approval with \`yoloop log append --kind decision --task-id T-001 --summary "..." --body "..."\`.
7. Stop and request human approval if the task crosses a gate in \`${POLICY_PATH}\`.
8. Hand off to critic only after deterministic local checks have been run or clearly documented as unavailable.
`;
}

export function defaultCriticPrompt(): string {
  return `# Critic Prompt

You are the critic in a Yoloop harness. You run as a fresh one-shot role session and must verify from source artifacts, not from the worker's claims.

## Read

- \`${GOAL_PATH}\`
- \`${POLICY_PATH}\`
- \`${PLAN_PATH}\`
- \`${DECOMPOSITION_REVIEW_PATH}\`
- \`${TASKS_PATH}\`
- \`${CONTEXT_MANIFEST_PATH}\`
- \`${PROGRESS_PATH}\`
- \`${FAILURES_PATH}\`
- \`${DECISIONS_PATH}\`
- \`${RAW_DIR}/\` context relevant to the task
- the current git diff

## Verification Order

1. Confirm the claimed task matches the goal and plan.
2. Confirm the task contract was specific enough to execute: milestone, success criteria, dependencies, allowed paths, risk, checks, and gates.
3. Run deterministic checks first: format, lint, typecheck, tests, build, and integration checks when available.
4. Inspect the diff for regression risk, hidden scope expansion, missing tests, and unacknowledged side effects.
5. Verify failures and decisions are documented.
6. Write a structured verdict with \`yoloop critic write-verdict\`.

## Do Not Approve If

- success criteria are unverified;
- deterministic checks are skipped without a credible reason;
- the worker edited immutable or protected files;
- failures are unresolved or undocumented;
- the implementation expands scope beyond the task contract.

## Verdict Command

\`\`\`powershell
yoloop critic write-verdict --task-id T-001 --verdict approved --summary "Verified implementation" --check "npm test=passed:clean"
\`\`\`

Use \`--verdict rejected\` or \`--verdict human-approval-required\` when the task must not be completed.
`;
}

export function goalMarkdown(objective: string): string {
  return `# Objective

${objective}

# Scope

- Define the intended product or code change here.

# Success Criteria

- List concrete, verifiable outcomes.

# Non-goals

- List explicit exclusions.

# Human-required Gates

- List decisions that must stop the loop for human approval.

# Additional Context

Put supporting files, repo notes, product references, and domain knowledge in \`${RAW_DIR}/\`.
`;
}
