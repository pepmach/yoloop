import {
  DECISIONS_PATH,
  FAILURES_PATH,
  GOAL_HASH_PATH,
  GOAL_PATH,
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
    protectedPathsWhileActive: [POLICY_PATH, PROGRESS_PATH, FAILURES_PATH, DECISIONS_PATH],
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
        workerArgs: [
          "-p",
          `Read {{worker_prompt}} first, inspect ${RAW_DIR}/ for extra context, then claim and execute exactly one pending task from {{tasks}}. Treat {{goal}}, {{policy}}, and {{plan}} as authoritative.`,
        ],
        criticArgs: [
          "-p",
          "Read {{critic_prompt}} first, inspect the current diff, run available checks, and write a verdict with yoloop critic write-verdict.",
        ],
        grandJuryArgs: [
          "-p",
          "Read {{goal}}, {{plan}}, {{tasks}}, {{progress}}, {{failures}}, {{decisions}}, raw/ context, and all critic verdicts. Approve only if the entire run is complete and clean. Write the final verdict with yoloop grand-jury write-verdict.",
        ],
      },
      {
        id: "codex-cli",
        label: "Codex CLI",
        command: "codex",
        workerArgs: [
          "exec",
          `Read {{worker_prompt}} first, inspect ${RAW_DIR}/ for extra context, then claim and execute exactly one pending task from {{tasks}}. Treat {{goal}}, {{policy}}, and {{plan}} as authoritative.`,
        ],
        criticArgs: [
          "exec",
          "Read {{critic_prompt}} first, inspect the current diff, run available checks, and write a verdict with yoloop critic write-verdict.",
        ],
        grandJuryArgs: [
          "exec",
          "Read {{goal}}, {{plan}}, {{tasks}}, {{progress}}, {{failures}}, {{decisions}}, raw/ context, and all critic verdicts. Approve only if the entire run is complete and clean. Write the final verdict with yoloop grand-jury write-verdict.",
        ],
      },
    ],
  };
}

export function defaultTasks(): TaskLedger {
  const now = nowIso();
  return {
    schemaVersion: 1,
    tasks: [
      {
        id: "T-001",
        title: "Replace this seed task with the first implementation slice",
        description: "Describe the smallest useful task the first worker should complete.",
        status: "pending",
        priority: 100,
        attempts: 0,
        claimedBy: null,
        dependsOn: [],
        allowedPaths: ["."],
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export function defaultPlan(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Yoloop Plan</title>
</head>
<body>
  <h1>Plan</h1>
  <section id="foundation">
    <h2>Phase 1: Foundation</h2>
    <ul>
      <li>Read <code>${RAW_DIR}/</code> for user-provided context before decomposing work.</li>
      <li>Convert <code>${GOAL_PATH}</code> into scoped tasks.</li>
      <li>Keep each task small enough for one worker session.</li>
      <li>Require critic approval before marking a task complete.</li>
    </ul>
  </section>
  <section id="implementation">
    <h2>Phase 2: Implementation</h2>
    <ul>
      <li>Worker claims one pending task from <code>${TASKS_PATH}</code>.</li>
      <li>Worker appends curated entries to <code>${PROGRESS_PATH}</code>, <code>${FAILURES_PATH}</code>, and <code>${DECISIONS_PATH}</code> through <code>yoloop log append</code> at state transitions.</li>
      <li>Worker hands off to critic when implementation and local verification are complete.</li>
    </ul>
  </section>
  <section id="verification">
    <h2>Phase 3: Verification</h2>
    <ul>
      <li>Critic runs deterministic checks first.</li>
      <li>Critic performs gap analysis against <code>${GOAL_PATH}</code>, <code>${PLAN_PATH}</code>, and the task contract.</li>
      <li>Critic writes a verdict with <code>yoloop critic write-verdict</code>.</li>
    </ul>
  </section>
  <section id="final-jury">
    <h2>Phase 4: Final Jury</h2>
    <ul>
      <li>Grand jury verifies all tasks are complete.</li>
      <li>Grand jury checks for unacknowledged side effects and unresolved failures.</li>
      <li>Grand jury writes a structured final verdict with <code>yoloop grand-jury write-verdict</code>.</li>
      <li>Harness emits <code>&lt;yoloop-done&gt;</code> only after the final jury passes.</li>
    </ul>
  </section>
</body>
</html>
`;
}

export function defaultWorkerPrompt(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Yoloop Worker Prompt</title>
</head>
<body>
  <h1>Worker Prompt</h1>
  <p>You are the worker in a Yoloop harness.</p>
  <section id="read-first">
    <h2>Read These Files First</h2>
    <dl>
      <dt><code>${GOAL_PATH}</code></dt><dd>Immutable human objective and success criteria.</dd>
      <dt><code>${POLICY_PATH}</code></dt><dd>Budgets, protected files, and human approval gates.</dd>
      <dt><code>${PLAN_PATH}</code></dt><dd>Implementation plan.</dd>
      <dt><code>${TASKS_PATH}</code></dt><dd>Source of truth for task status and ownership.</dd>
      <dt><code>${PROGRESS_PATH}</code></dt><dd>Append-only human-readable progress. Append with <code>yoloop log append --kind progress</code>; do not edit directly.</dd>
      <dt><code>${FAILURES_PATH}</code></dt><dd>Append-only failure memory. Append with <code>yoloop log append --kind failure</code>; do not edit directly.</dd>
      <dt><code>${DECISIONS_PATH}</code></dt><dd>Append-only decision log. Append with <code>yoloop log append --kind decision</code>; do not edit directly.</dd>
      <dt><code>${RAW_DIR}/</code></dt><dd>User-supplied product notes, repo context, references, and domain knowledge.</dd>
    </dl>
  </section>
  <section id="protocol">
    <h2>Protocol</h2>
    <ol>
      <li>Claim exactly one pending task.</li>
      <li>Survey relevant repo context and <code>${RAW_DIR}/</code> before editing.</li>
      <li>Append a progress entry at meaningful state transitions with <code>yoloop log append --kind progress --task-id T-001 --summary "..." --body "..."</code>.</li>
      <li>Append a failure entry after every failed test, build, rejected approach, or critic rejection with <code>yoloop log append --kind failure --task-id T-001 --summary "..." --body "..."</code>.</li>
      <li>Append a decision entry for important implementation choices that do not require human approval with <code>yoloop log append --kind decision --task-id T-001 --summary "..." --body "..."</code>.</li>
      <li>Stop and request human approval if the task crosses a gate in <code>${POLICY_PATH}</code>.</li>
      <li>Hand off to critic only after deterministic local checks have been run or clearly documented as unavailable.</li>
    </ol>
  </section>
</body>
</html>
`;
}

export function defaultCriticPrompt(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Yoloop Critic Prompt</title>
</head>
<body>
  <h1>Critic Prompt</h1>
  <p>You are the critic in a Yoloop harness.</p>
  <section id="read">
    <h2>Read</h2>
    <ul>
      <li><code>${GOAL_PATH}</code></li>
      <li><code>${POLICY_PATH}</code></li>
      <li><code>${PLAN_PATH}</code></li>
      <li><code>${TASKS_PATH}</code></li>
      <li><code>${PROGRESS_PATH}</code></li>
      <li><code>${FAILURES_PATH}</code></li>
      <li><code>${DECISIONS_PATH}</code></li>
      <li><code>${RAW_DIR}/</code> context relevant to the task</li>
      <li>the current git diff</li>
    </ul>
  </section>
  <section id="verification-order">
    <h2>Verification Order</h2>
    <ol>
      <li>Confirm the claimed task matches the goal and plan.</li>
      <li>Run deterministic checks first: format, lint, typecheck, tests, build, and integration checks when available.</li>
      <li>Inspect the diff for regression risk, hidden scope expansion, missing tests, and unacknowledged side effects.</li>
      <li>Verify failures and decisions are documented.</li>
      <li>Write a structured verdict with <code>yoloop critic write-verdict</code>.</li>
    </ol>
  </section>
  <section id="rejection-rules">
    <h2>Do Not Approve If</h2>
    <ul>
      <li>success criteria are unverified;</li>
      <li>deterministic checks are skipped without a credible reason;</li>
      <li>the worker edited immutable or protected files;</li>
      <li>failures are unresolved or undocumented;</li>
      <li>the implementation expands scope beyond the task contract.</li>
    </ul>
  </section>
  <section id="verdict-command">
    <h2>Verdict Command</h2>
    <pre><code>yoloop critic write-verdict --task-id T-001 --verdict approved --summary "Verified implementation" --check "npm test=passed:clean"</code></pre>
    <p>Use <code>--verdict rejected</code> or <code>--verdict human-approval-required</code> when the task must not be completed.</p>
  </section>
</body>
</html>
`;
}

export function emptyLogHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Yoloop ${title}</title>
</head>
<body>
  <h1>${title}</h1>
  <section id="entries">
  </section>
</body>
</html>
`;
}

export function goalHtml(objective: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Yoloop Goal</title>
</head>
<body>
  <h1>Objective</h1>
  <p>${escapeHtml(objective)}</p>
  <h1>Scope</h1>
  <ul><li>Define the intended product or code change here.</li></ul>
  <h1>Success Criteria</h1>
  <ul><li>List concrete, verifiable outcomes.</li></ul>
  <h1>Non-goals</h1>
  <ul><li>List explicit exclusions.</li></ul>
  <h1>Human-required Gates</h1>
  <ul><li>List decisions that must stop the loop for human approval.</li></ul>
  <h1>Additional Context</h1>
  <p>Put supporting files, repo notes, product references, and domain knowledge in <code>${RAW_DIR}/</code>.</p>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
