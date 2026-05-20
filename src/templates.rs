use crate::{
    models::{AdapterCatalog, AgentAdapter, HumanGate, LoopPolicy, Task, TaskLedger, TaskStatus},
    paths::{
        DECISIONS_PATH, FAILURES_PATH, GOAL_HASH_PATH, GOAL_PATH, PLAN_PATH, POLICY_PATH,
        PROGRESS_PATH, RAW_DIR, TASKS_PATH,
    },
};
use chrono::Utc;

pub(crate) fn default_policy() -> LoopPolicy {
    LoopPolicy {
        schema_version: 1,
        active: true,
        max_iterations: 50,
        max_wall_clock_minutes: 480,
        max_retries_per_task: 3,
        immutable_paths: vec![GOAL_PATH.to_string(), GOAL_HASH_PATH.to_string()],
        protected_paths_while_active: vec![POLICY_PATH.to_string()],
        allowed_write_roots: vec![".".to_string()],
        deny_shell_substrings: vec![
            "git reset --hard".to_string(),
            "git checkout --".to_string(),
            "rm -rf".to_string(),
            "remove-item -recurse".to_string(),
            "format-volume".to_string(),
        ],
        human_gates: vec![
            HumanGate {
                id: "dependency-change".to_string(),
                description: "Changing lockfiles or package manifests requires human approval unless the task explicitly allows it.".to_string(),
                path_globs: vec![
                    "package-lock.json".to_string(),
                    "pnpm-lock.yaml".to_string(),
                    "yarn.lock".to_string(),
                    "Cargo.lock".to_string(),
                    "package.json".to_string(),
                    "Cargo.toml".to_string(),
                ],
                command_substrings: vec![
                    "npm install".to_string(),
                    "pnpm add".to_string(),
                    "cargo add".to_string(),
                ],
            },
            HumanGate {
                id: "security-sensitive".to_string(),
                description: "Auth, permissions, secrets, migrations, and production deploy changes require explicit human approval.".to_string(),
                path_globs: vec![
                    ".env".to_string(),
                    "migrations/".to_string(),
                    "auth/".to_string(),
                    "permissions/".to_string(),
                ],
                command_substrings: vec!["deploy".to_string(), "migration".to_string()],
            },
        ],
    }
}

pub(crate) fn default_adapters() -> AdapterCatalog {
    AdapterCatalog {
        schema_version: 1,
        adapters: vec![
            AgentAdapter {
                id: "claude-code".to_string(),
                label: "Claude Code".to_string(),
                command: "claude".to_string(),
                worker_args: vec![
                    "-p".to_string(),
                    format!("Read {{{{worker_prompt}}}} first, inspect {RAW_DIR}/ for extra context, then claim and execute exactly one pending task from {{{{tasks}}}}. Treat {{{{goal}}}}, {{{{policy}}}}, and {{{{plan}}}} as authoritative."),
                ],
                critic_args: vec![
                    "-p".to_string(),
                    "Read {{critic_prompt}} first, inspect the current diff, run available checks, and write a verdict with yoloop critic write-verdict.".to_string(),
                ],
                grand_jury_args: vec![
                    "-p".to_string(),
                    "Read {{goal}}, {{plan}}, {{tasks}}, {{progress}}, {{failures}}, {{decisions}}, raw/ context, and all critic verdicts. Approve only if the entire run is complete and clean.".to_string(),
                ],
            },
            AgentAdapter {
                id: "codex-cli".to_string(),
                label: "Codex CLI".to_string(),
                command: "codex".to_string(),
                worker_args: vec![
                    "exec".to_string(),
                    format!("Read {{{{worker_prompt}}}} first, inspect {RAW_DIR}/ for extra context, then claim and execute exactly one pending task from {{{{tasks}}}}. Treat {{{{goal}}}}, {{{{policy}}}}, and {{{{plan}}}} as authoritative."),
                ],
                critic_args: vec![
                    "exec".to_string(),
                    "Read {{critic_prompt}} first, inspect the current diff, run available checks, and write a verdict with yoloop critic write-verdict.".to_string(),
                ],
                grand_jury_args: vec![
                    "exec".to_string(),
                    "Read {{goal}}, {{plan}}, {{tasks}}, {{progress}}, {{failures}}, {{decisions}}, raw/ context, and all critic verdicts. Approve only if the entire run is complete and clean.".to_string(),
                ],
            },
        ],
    }
}

pub(crate) fn default_tasks() -> TaskLedger {
    let now = Utc::now();
    TaskLedger {
        schema_version: 1,
        tasks: vec![Task {
            id: "T-001".to_string(),
            title: "Replace this seed task with the first implementation slice".to_string(),
            description: "Describe the smallest useful task the first worker should complete."
                .to_string(),
            status: TaskStatus::Pending,
            priority: 100,
            attempts: 0,
            claimed_by: None,
            depends_on: vec![],
            allowed_paths: vec![".".to_string()],
            created_at: now,
            updated_at: now,
        }],
    }
}

pub(crate) fn default_plan() -> String {
    format!(
        r#"<!doctype html>
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
      <li>Read <code>{raw_dir}/</code> for user-provided context before decomposing work.</li>
      <li>Convert <code>{goal}</code> into scoped tasks.</li>
      <li>Keep each task small enough for one worker session.</li>
      <li>Require critic approval before marking a task complete.</li>
    </ul>
  </section>
  <section id="implementation">
    <h2>Phase 2: Implementation</h2>
    <ul>
      <li>Worker claims one pending task from <code>{tasks}</code>.</li>
      <li>Worker updates <code>{progress}</code>, <code>{failures}</code>, and <code>{decisions}</code> at state transitions.</li>
      <li>Worker hands off to critic when implementation and local verification are complete.</li>
    </ul>
  </section>
  <section id="verification">
    <h2>Phase 3: Verification</h2>
    <ul>
      <li>Critic runs deterministic checks first.</li>
      <li>Critic performs gap analysis against <code>{goal}</code>, <code>{plan}</code>, and the task contract.</li>
      <li>Critic writes a verdict with <code>yoloop critic write-verdict</code>.</li>
    </ul>
  </section>
  <section id="final-jury">
    <h2>Phase 4: Final Jury</h2>
    <ul>
      <li>Grand jury verifies all tasks are complete.</li>
      <li>Grand jury checks for unacknowledged side effects and unresolved failures.</li>
      <li>Harness emits <code>&lt;yoloop-done&gt;</code> only after the final jury passes.</li>
    </ul>
  </section>
</body>
</html>
"#,
        raw_dir = RAW_DIR,
        goal = GOAL_PATH,
        tasks = TASKS_PATH,
        progress = PROGRESS_PATH,
        failures = FAILURES_PATH,
        decisions = DECISIONS_PATH,
        plan = PLAN_PATH,
    )
}

pub(crate) fn default_worker_prompt() -> String {
    format!(
        r#"<!doctype html>
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
      <dt><code>{goal}</code></dt><dd>Immutable human objective and success criteria.</dd>
      <dt><code>{policy}</code></dt><dd>Budgets, protected files, and human approval gates.</dd>
      <dt><code>{plan}</code></dt><dd>Implementation plan.</dd>
      <dt><code>{tasks}</code></dt><dd>Source of truth for task status and ownership.</dd>
      <dt><code>{progress}</code></dt><dd>Append-only human-readable progress.</dd>
      <dt><code>{failures}</code></dt><dd>Append-only failure memory.</dd>
      <dt><code>{decisions}</code></dt><dd>Append-only decision log.</dd>
      <dt><code>{raw_dir}/</code></dt><dd>User-supplied product notes, repo context, references, and domain knowledge.</dd>
    </dl>
  </section>
  <section id="protocol">
    <h2>Protocol</h2>
    <ol>
      <li>Claim exactly one pending task.</li>
      <li>Survey relevant repo context and <code>{raw_dir}/</code> before editing.</li>
      <li>Update <code>{progress}</code> at state transitions.</li>
      <li>Update <code>{failures}</code> after every failed test, build, or rejected approach.</li>
      <li>Update <code>{decisions}</code> for important implementation choices.</li>
      <li>Stop and request human approval if the task crosses a gate in <code>{policy}</code>.</li>
      <li>Hand off to critic only after deterministic local checks have been run or clearly documented as unavailable.</li>
    </ol>
  </section>
</body>
</html>
"#,
        goal = GOAL_PATH,
        policy = POLICY_PATH,
        plan = PLAN_PATH,
        tasks = TASKS_PATH,
        progress = PROGRESS_PATH,
        failures = FAILURES_PATH,
        decisions = DECISIONS_PATH,
        raw_dir = RAW_DIR,
    )
}

pub(crate) fn default_critic_prompt() -> String {
    format!(
        r#"<!doctype html>
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
      <li><code>{goal}</code></li>
      <li><code>{policy}</code></li>
      <li><code>{plan}</code></li>
      <li><code>{tasks}</code></li>
      <li><code>{progress}</code></li>
      <li><code>{failures}</code></li>
      <li><code>{decisions}</code></li>
      <li><code>{raw_dir}/</code> context relevant to the task</li>
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
    <pre><code>yoloop critic write-verdict --task-id T-001 --verdict approved --summary "Verified implementation" --check "cargo check=passed:clean"</code></pre>
    <p>Use <code>--verdict rejected</code> or <code>--verdict human-approval-required</code> when the task must not be completed.</p>
  </section>
</body>
</html>
"#,
        goal = GOAL_PATH,
        policy = POLICY_PATH,
        plan = PLAN_PATH,
        tasks = TASKS_PATH,
        progress = PROGRESS_PATH,
        failures = FAILURES_PATH,
        decisions = DECISIONS_PATH,
        raw_dir = RAW_DIR,
    )
}

pub(crate) fn empty_log_html(title: &str) -> String {
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Yoloop {}</title>
</head>
<body>
  <h1>{}</h1>
  <section id="entries">
  </section>
</body>
</html>
"#,
        title, title
    )
}

pub(crate) fn goal_html(objective: String) -> String {
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Yoloop Goal</title>
</head>
<body>
  <h1>Objective</h1>
  <p>{}</p>
  <h1>Scope</h1>
  <ul><li>Define the intended product or code change here.</li></ul>
  <h1>Success Criteria</h1>
  <ul><li>List concrete, verifiable outcomes.</li></ul>
  <h1>Non-goals</h1>
  <ul><li>List explicit exclusions.</li></ul>
  <h1>Human-required Gates</h1>
  <ul><li>List decisions that must stop the loop for human approval.</li></ul>
  <h1>Additional Context</h1>
  <p>Put supporting files, repo notes, product references, and domain knowledge in <code>{}/</code>.</p>
</body>
</html>
"#,
        escape_html(&objective),
        RAW_DIR
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
