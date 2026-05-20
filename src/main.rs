use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::Command as ProcessCommand,
};

use anyhow::{anyhow, bail, Context, Result};
use chrono::{DateTime, Utc};
use clap::{Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const YOLOOP_DIR: &str = ".yoloop";
const GOAL_PATH: &str = "GOAL.html";
const GOAL_HASH_PATH: &str = ".yoloop/goal.sha256";
const POLICY_PATH: &str = "LOOP_POLICY.json";
const TASKS_PATH: &str = "TASKS.json";
const ADAPTERS_PATH: &str = "ADAPTERS.json";
const EVENTS_PATH: &str = ".yoloop/events.jsonl";
const PLAN_PATH: &str = "PLAN.html";
const WORKER_PROMPT_PATH: &str = "WORKER_PROMPT.html";
const CRITIC_PROMPT_PATH: &str = "CRITIC_PROMPT.html";
const PROGRESS_PATH: &str = "PROGRESS.html";
const FAILURES_PATH: &str = "FAILURES.html";
const DECISIONS_PATH: &str = "DECISIONS.html";

#[derive(Parser)]
#[command(name = "yoloop")]
#[command(about = "Durable agent-loop harness for long-running coding agents")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Create the durable harness files in the current repository.
    Init {
        /// Initial objective text to place into GOAL.html.
        #[arg(long)]
        goal: Option<String>,

        /// Overwrite existing generated harness files.
        #[arg(long)]
        force: bool,
    },

    /// Print task and policy status.
    Status,

    /// Check harness invariants and missing files.
    Doctor,

    /// Pause policy enforcement for a planned human edit.
    Pause {
        /// Actor recorded in the event log.
        #[arg(long, default_value = "human")]
        actor: String,
    },

    /// Resume policy enforcement after validating the goal hash.
    Resume {
        /// Actor recorded in the event log.
        #[arg(long, default_value = "human")]
        actor: String,
    },

    /// Accept the current GOAL.html as the immutable goal for the next run.
    AcceptGoal {
        /// Actor recorded in the event log.
        #[arg(long, default_value = "human")]
        actor: String,
    },

    /// Claim the next pending task in TASKS.json.
    ClaimNext {
        /// Stable worker/session identifier.
        #[arg(long, default_value = "worker-local")]
        worker: String,
    },

    /// Run one configured host adapter role.
    Run {
        /// Adapter id from ADAPTERS.json.
        #[arg(long, default_value = "claude-code")]
        adapter: String,

        /// Harness role to launch.
        #[arg(long, value_enum, default_value_t = AgentRole::Worker)]
        role: AgentRole,

        /// Execute the adapter command. Without this, Yoloop prints a dry run.
        #[arg(long)]
        execute: bool,
    },

    /// Task ledger operations.
    Task {
        #[command(subcommand)]
        command: TaskCommand,
    },

    /// Hook entrypoints used by Claude Code or other agent hosts.
    Hook {
        #[command(subcommand)]
        command: HookCommand,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum AgentRole {
    Worker,
    Critic,
    GrandJury,
}

#[derive(Subcommand)]
enum HookCommand {
    /// Claude Code PreToolUse policy hook. Reads hook JSON from stdin.
    Pretooluse,
}

#[derive(Subcommand)]
enum TaskCommand {
    /// Set a task status in TASKS.json.
    SetStatus {
        #[arg(long)]
        id: String,

        #[arg(long)]
        status: String,

        #[arg(long, default_value = "yoloop")]
        actor: String,

        #[arg(long, default_value = "")]
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoopPolicy {
    schema_version: u32,
    active: bool,
    max_iterations: u32,
    max_wall_clock_minutes: u32,
    max_retries_per_task: u32,
    immutable_paths: Vec<String>,
    protected_paths_while_active: Vec<String>,
    allowed_write_roots: Vec<String>,
    deny_shell_substrings: Vec<String>,
    human_gates: Vec<HumanGate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HumanGate {
    id: String,
    description: String,
    path_globs: Vec<String>,
    command_substrings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdapterCatalog {
    schema_version: u32,
    adapters: Vec<AgentAdapter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentAdapter {
    id: String,
    label: String,
    command: String,
    worker_args: Vec<String>,
    critic_args: Vec<String>,
    grand_jury_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskLedger {
    schema_version: u32,
    tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Task {
    id: String,
    title: String,
    description: String,
    status: TaskStatus,
    priority: u32,
    attempts: u32,
    claimed_by: Option<String>,
    depends_on: Vec<String>,
    allowed_paths: Vec<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TaskStatus {
    Pending,
    InProgress,
    CriticReview,
    Completed,
    Cancelled,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Event {
    timestamp: DateTime<Utc>,
    kind: String,
    actor: String,
    task_id: Option<String>,
    message: String,
    data: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct HookInput {
    tool_name: String,
    #[serde(default)]
    tool_input: Value,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("error: {err:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    let root = std::env::current_dir().context("read current directory")?;

    match cli.command {
        Command::Init { goal, force } => init(&root, goal, force),
        Command::Status => status(&root),
        Command::Doctor => doctor(&root),
        Command::Pause { actor } => set_active(&root, false, &actor),
        Command::Resume { actor } => {
            goal_integrity(&root)?;
            set_active(&root, true, &actor)
        }
        Command::AcceptGoal { actor } => accept_goal(&root, &actor),
        Command::ClaimNext { worker } => claim_next(&root, &worker),
        Command::Run {
            adapter,
            role,
            execute,
        } => run_adapter(&root, &adapter, role, execute),
        Command::Task { command } => match command {
            TaskCommand::SetStatus {
                id,
                status,
                actor,
                message,
            } => set_task_status(&root, &id, &status, &actor, &message),
        },
        Command::Hook { command } => match command {
            HookCommand::Pretooluse => hook_pretooluse(&root),
        },
    }
}

fn init(root: &Path, goal: Option<String>, force: bool) -> Result<()> {
    ensure_dir(root.join(YOLOOP_DIR))?;
    ensure_dir(root.join(".yoloop/critic-verdicts"))?;
    ensure_dir(root.join("raw"))?;

    write_new(
        root.join(GOAL_PATH),
        goal_html(goal.unwrap_or_else(|| "Describe the objective here.".to_string())),
        force,
    )?;
    write_new(
        root.join(POLICY_PATH),
        pretty_json(&default_policy())?,
        force,
    )?;
    write_new(root.join(TASKS_PATH), pretty_json(&default_tasks())?, force)?;
    write_new(
        root.join(ADAPTERS_PATH),
        pretty_json(&default_adapters())?,
        force,
    )?;
    write_new(root.join(PLAN_PATH), default_plan(), force)?;
    write_new(
        root.join(WORKER_PROMPT_PATH),
        default_worker_prompt(),
        force,
    )?;
    write_new(
        root.join(CRITIC_PROMPT_PATH),
        default_critic_prompt(),
        force,
    )?;
    write_new(root.join(PROGRESS_PATH), empty_log_html("Progress"), force)?;
    write_new(root.join(FAILURES_PATH), empty_log_html("Failures"), force)?;
    write_new(
        root.join(DECISIONS_PATH),
        empty_log_html("Decisions"),
        force,
    )?;
    write_new(root.join(EVENTS_PATH), String::new(), force)?;

    let hash = goal_hash(root)?;
    fs::write(root.join(GOAL_HASH_PATH), format!("{hash}\n")).context("write goal hash")?;

    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: "harness.initialized".to_string(),
            actor: "yoloop".to_string(),
            task_id: None,
            message: "Initialized Yoloop harness.".to_string(),
            data: BTreeMap::new(),
        },
    )?;

    println!("Initialized Yoloop harness in {}", root.display());
    println!("Next: edit GOAL.html, PLAN.html, TASKS.json, then run `yoloop doctor`.");
    println!("Adapter templates live in ADAPTERS.json; run `yoloop run` to inspect the command before executing.");
    Ok(())
}

fn status(root: &Path) -> Result<()> {
    let policy = read_policy(root)?;
    let tasks = read_tasks(root)?;
    let goal_state = goal_integrity(root)?;

    let mut counts = BTreeMap::<String, usize>::new();
    for task in &tasks.tasks {
        *counts.entry(format!("{:?}", task.status)).or_default() += 1;
    }

    println!("Yoloop status");
    println!("  active: {}", policy.active);
    println!("  goal: {goal_state}");
    println!("  tasks:");
    for (status, count) in counts {
        println!("    {status}: {count}");
    }

    if let Some(next) = next_claimable_task(&tasks) {
        println!("  next: {} - {}", next.id, next.title);
    } else {
        println!("  next: none");
    }

    Ok(())
}

fn doctor(root: &Path) -> Result<()> {
    let required = [
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

    let mut ok = true;
    for path in required {
        if root.join(path).exists() {
            println!("ok: {path}");
        } else {
            ok = false;
            println!("missing: {path}");
        }
    }

    match read_policy(root) {
        Ok(_) => println!("ok: policy parses"),
        Err(err) => {
            ok = false;
            println!("bad: policy parse failed: {err:#}");
        }
    }

    match read_tasks(root) {
        Ok(_) => println!("ok: task ledger parses"),
        Err(err) => {
            ok = false;
            println!("bad: task ledger parse failed: {err:#}");
        }
    }

    match read_adapters(root) {
        Ok(_) => println!("ok: adapters parse"),
        Err(err) => {
            ok = false;
            println!("bad: adapters parse failed: {err:#}");
        }
    }

    match goal_integrity(root) {
        Ok(msg) => println!("ok: goal {msg}"),
        Err(err) => {
            ok = false;
            println!("bad: goal integrity failed: {err:#}");
        }
    }

    if ok {
        println!("doctor: clean");
        Ok(())
    } else {
        bail!("doctor found harness problems")
    }
}

fn claim_next(root: &Path, worker: &str) -> Result<()> {
    let mut ledger = read_tasks(root)?;
    let now = Utc::now();
    let task = ledger
        .tasks
        .iter_mut()
        .filter(|task| task.status == TaskStatus::Pending)
        .min_by_key(|task| task.priority)
        .ok_or_else(|| anyhow!("no pending task available"))?;

    task.status = TaskStatus::InProgress;
    task.claimed_by = Some(worker.to_string());
    task.attempts += 1;
    task.updated_at = now;

    let task_id = task.id.clone();
    let title = task.title.clone();
    fs::write(root.join(TASKS_PATH), pretty_json(&ledger)?).context("write TASKS.json")?;
    append_event(
        root,
        Event {
            timestamp: now,
            kind: "task.claimed".to_string(),
            actor: worker.to_string(),
            task_id: Some(task_id.clone()),
            message: format!("Claimed task {task_id}: {title}"),
            data: BTreeMap::new(),
        },
    )?;

    println!("{task_id}");
    Ok(())
}

fn run_adapter(root: &Path, adapter_id: &str, role: AgentRole, execute: bool) -> Result<()> {
    goal_integrity(root)?;
    let catalog = read_adapters(root)?;
    let adapter = catalog
        .adapters
        .iter()
        .find(|adapter| adapter.id == adapter_id)
        .ok_or_else(|| anyhow!("adapter not found in ADAPTERS.json: {adapter_id}"))?;
    let args = render_adapter_args(root, adapter, role);
    let rendered = format_command(&adapter.command, &args);

    if !execute {
        println!("{rendered}");
        println!("dry-run only; add --execute to run this adapter role");
        return Ok(());
    }

    ensure_dir(root.join(".yoloop/runs"))?;
    let run_id = format!(
        "{}-{}-{}",
        Utc::now().format("%Y%m%dT%H%M%SZ"),
        adapter.id,
        role.as_str()
    );
    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: "adapter.run_started".to_string(),
            actor: "yoloop".to_string(),
            task_id: None,
            message: format!("Started {rendered}"),
            data: BTreeMap::from([
                ("adapter".to_string(), Value::String(adapter.id.clone())),
                ("role".to_string(), Value::String(role.as_str().to_string())),
                ("runId".to_string(), Value::String(run_id.clone())),
            ]),
        },
    )?;

    let output = ProcessCommand::new(&adapter.command)
        .args(&args)
        .current_dir(root)
        .output()
        .with_context(|| format!("run adapter command `{}`", adapter.command))?;

    let stdout_path = format!(".yoloop/runs/{run_id}.stdout.txt");
    let stderr_path = format!(".yoloop/runs/{run_id}.stderr.txt");
    fs::write(root.join(&stdout_path), &output.stdout).context("write adapter stdout")?;
    fs::write(root.join(&stderr_path), &output.stderr).context("write adapter stderr")?;

    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: "adapter.run_finished".to_string(),
            actor: "yoloop".to_string(),
            task_id: None,
            message: format!("Finished {rendered} with status {}", output.status),
            data: BTreeMap::from([
                ("adapter".to_string(), Value::String(adapter.id.clone())),
                ("role".to_string(), Value::String(role.as_str().to_string())),
                ("runId".to_string(), Value::String(run_id)),
                ("success".to_string(), Value::Bool(output.status.success())),
                (
                    "code".to_string(),
                    output
                        .status
                        .code()
                        .map(|code| Value::Number(code.into()))
                        .unwrap_or(Value::Null),
                ),
                ("stdout".to_string(), Value::String(stdout_path)),
                ("stderr".to_string(), Value::String(stderr_path)),
            ]),
        },
    )?;

    if !output.status.success() {
        bail!("adapter command failed with status {}", output.status);
    }

    Ok(())
}

fn set_task_status(root: &Path, id: &str, status: &str, actor: &str, message: &str) -> Result<()> {
    let parsed_status = parse_task_status(status)?;
    let mut ledger = read_tasks(root)?;
    let now = Utc::now();
    let task = ledger
        .tasks
        .iter_mut()
        .find(|task| task.id == id)
        .ok_or_else(|| anyhow!("task not found: {id}"))?;

    task.status = parsed_status;
    task.updated_at = now;
    if matches!(parsed_status, TaskStatus::Pending | TaskStatus::Cancelled) {
        task.claimed_by = None;
    }

    fs::write(root.join(TASKS_PATH), pretty_json(&ledger)?).context("write TASKS.json")?;

    append_event(
        root,
        Event {
            timestamp: now,
            kind: "task.status_changed".to_string(),
            actor: actor.to_string(),
            task_id: Some(id.to_string()),
            message: if message.is_empty() {
                format!("Set task {id} to {status}.")
            } else {
                message.to_string()
            },
            data: BTreeMap::from([("status".to_string(), Value::String(status.to_string()))]),
        },
    )?;

    println!("{id}: {parsed_status:?}");
    Ok(())
}

fn set_active(root: &Path, active: bool, actor: &str) -> Result<()> {
    let mut policy = read_policy(root)?;
    policy.active = active;
    fs::write(root.join(POLICY_PATH), pretty_json(&policy)?).context("write LOOP_POLICY.json")?;
    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: if active {
                "policy.resumed".to_string()
            } else {
                "policy.paused".to_string()
            },
            actor: actor.to_string(),
            task_id: None,
            message: if active {
                "Loop policy enforcement resumed.".to_string()
            } else {
                "Loop policy enforcement paused.".to_string()
            },
            data: BTreeMap::new(),
        },
    )?;
    println!("active: {active}");
    Ok(())
}

fn accept_goal(root: &Path, actor: &str) -> Result<()> {
    let policy = read_policy(root)?;
    if policy.active {
        bail!("cannot accept a changed goal while policy is active; run `yoloop pause` first")
    }

    let hash = goal_hash(root)?;
    fs::write(root.join(GOAL_HASH_PATH), format!("{hash}\n")).context("write goal hash")?;
    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: "goal.accepted".to_string(),
            actor: actor.to_string(),
            task_id: None,
            message: "Accepted current GOAL.html hash.".to_string(),
            data: BTreeMap::from([("sha256".to_string(), Value::String(hash.clone()))]),
        },
    )?;
    println!("{hash}");
    Ok(())
}

fn hook_pretooluse(root: &Path) -> Result<()> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .context("read hook stdin")?;
    let hook: HookInput = serde_json::from_str(&input).context("parse hook input")?;

    let policy = match read_policy(root) {
        Ok(policy) => policy,
        Err(_) => return Ok(()),
    };

    if !policy.active {
        return Ok(());
    }

    if is_mutating_tool(&hook.tool_name) && goal_integrity(root).is_err() {
        return deny("GOAL.html hash changed while the loop is active. Stop the loop, accept the goal update, then relaunch.");
    }

    if let Some(path) = hook_file_path(&hook) {
        let normalized = normalize_path_for_policy(root, &path);
        if path_matches_any(&normalized, &policy.immutable_paths) {
            return deny(&format!(
                "Policy denies edits to immutable path `{normalized}`."
            ));
        }
        if path_matches_any(&normalized, &policy.protected_paths_while_active) {
            return deny(&format!(
                "Policy denies edits to protected path `{normalized}` while the loop is active."
            ));
        }
        if !policy.allowed_write_roots.is_empty()
            && !path_matches_any_prefix(&normalized, &policy.allowed_write_roots)
        {
            return deny(&format!(
                "Policy denies writes outside allowed roots. Path was `{normalized}`."
            ));
        }
    }

    if hook.tool_name == "Bash" {
        let command = hook
            .tool_input
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let lower = command.to_ascii_lowercase();
        if let Some(pattern) = policy
            .deny_shell_substrings
            .iter()
            .find(|pattern| lower.contains(&pattern.to_ascii_lowercase()))
        {
            return deny(&format!(
                "Policy denies shell command containing `{pattern}`."
            ));
        }
    }

    Ok(())
}

fn deny(reason: &str) -> Result<()> {
    let response = json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason
        }
    });
    println!("{}", serde_json::to_string(&response)?);
    Ok(())
}

fn default_policy() -> LoopPolicy {
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

fn default_adapters() -> AdapterCatalog {
    AdapterCatalog {
        schema_version: 1,
        adapters: vec![
            AgentAdapter {
                id: "claude-code".to_string(),
                label: "Claude Code".to_string(),
                command: "claude".to_string(),
                worker_args: vec![
                    "-p".to_string(),
                    "Read {{worker_prompt}} first, then claim and execute exactly one pending task from {{tasks}}. Treat {{goal}}, {{policy}}, and {{plan}} as authoritative.".to_string(),
                ],
                critic_args: vec![
                    "-p".to_string(),
                    "Read {{critic_prompt}} first, inspect the current diff, run available checks, and write a verdict under .yoloop/critic-verdicts/.".to_string(),
                ],
                grand_jury_args: vec![
                    "-p".to_string(),
                    "Read {{goal}}, {{plan}}, {{tasks}}, {{progress}}, {{failures}}, {{decisions}}, and all critic verdicts. Approve only if the entire run is complete and clean.".to_string(),
                ],
            },
            AgentAdapter {
                id: "codex-cli".to_string(),
                label: "Codex CLI".to_string(),
                command: "codex".to_string(),
                worker_args: vec![
                    "exec".to_string(),
                    "Read {{worker_prompt}} first, then claim and execute exactly one pending task from {{tasks}}. Treat {{goal}}, {{policy}}, and {{plan}} as authoritative.".to_string(),
                ],
                critic_args: vec![
                    "exec".to_string(),
                    "Read {{critic_prompt}} first, inspect the current diff, run available checks, and write a verdict under .yoloop/critic-verdicts/.".to_string(),
                ],
                grand_jury_args: vec![
                    "exec".to_string(),
                    "Read {{goal}}, {{plan}}, {{tasks}}, {{progress}}, {{failures}}, {{decisions}}, and all critic verdicts. Approve only if the entire run is complete and clean.".to_string(),
                ],
            },
        ],
    }
}

fn default_tasks() -> TaskLedger {
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

fn default_plan() -> String {
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
      <li>Convert <code>GOAL.html</code> into scoped tasks.</li>
      <li>Keep each task small enough for one worker session.</li>
      <li>Require critic approval before marking a task complete.</li>
    </ul>
  </section>

  <section id="implementation">
    <h2>Phase 2: Implementation</h2>
    <ul>
      <li>Worker claims one pending task from <code>TASKS.json</code>.</li>
      <li>Worker updates <code>PROGRESS.html</code>, <code>FAILURES.html</code>, and <code>DECISIONS.html</code> at state transitions.</li>
      <li>Worker hands off to critic when implementation and local verification are complete.</li>
    </ul>
  </section>

  <section id="verification">
    <h2>Phase 3: Verification</h2>
    <ul>
      <li>Critic runs deterministic checks first.</li>
      <li>Critic performs gap analysis against <code>GOAL.html</code>, <code>PLAN.html</code>, and the task contract.</li>
      <li>Critic writes a verdict under <code>.yoloop/critic-verdicts/</code>.</li>
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
"#
    .to_string()
}

fn default_worker_prompt() -> String {
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
      <dt><code>GOAL.html</code></dt>
      <dd>Immutable human objective and success criteria.</dd>
      <dt><code>LOOP_POLICY.json</code></dt>
      <dd>Budgets, protected files, and human approval gates.</dd>
      <dt><code>PLAN.html</code></dt>
      <dd>Implementation plan.</dd>
      <dt><code>TASKS.json</code></dt>
      <dd>Source of truth for task status and ownership.</dd>
      <dt><code>PROGRESS.html</code></dt>
      <dd>Append-only human-readable progress.</dd>
      <dt><code>FAILURES.html</code></dt>
      <dd>Append-only failure memory.</dd>
      <dt><code>DECISIONS.html</code></dt>
      <dd>Append-only decision log.</dd>
      <dt><code>raw/</code></dt>
      <dd>Extra domain and repository context.</dd>
    </dl>
  </section>

  <section id="protocol">
    <h2>Protocol</h2>
    <ol>
      <li>Claim exactly one pending task.</li>
      <li>Survey relevant repo context before editing.</li>
      <li>Update <code>PROGRESS.html</code> at state transitions.</li>
      <li>Update <code>FAILURES.html</code> after every failed test, build, or rejected approach.</li>
      <li>Update <code>DECISIONS.html</code> for important implementation choices.</li>
      <li>Stop and request human approval if the task crosses a gate in <code>LOOP_POLICY.json</code>.</li>
      <li>Hand off to critic only after deterministic local checks have been run or clearly documented as unavailable.</li>
    </ol>
  </section>
</body>
</html>
"#
    .to_string()
}

fn default_critic_prompt() -> String {
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
      <li><code>GOAL.html</code></li>
      <li><code>LOOP_POLICY.json</code></li>
      <li><code>PLAN.html</code></li>
      <li><code>TASKS.json</code></li>
      <li><code>PROGRESS.html</code></li>
      <li><code>FAILURES.html</code></li>
      <li><code>DECISIONS.html</code></li>
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
      <li>Write a structured verdict under <code>.yoloop/critic-verdicts/</code>.</li>
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
</body>
</html>
"#
    .to_string()
}

fn empty_log_html(title: &str) -> String {
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

fn goal_html(objective: String) -> String {
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
  <ul>
    <li>Define the intended product or code change here.</li>
  </ul>

  <h1>Success Criteria</h1>
  <ul>
    <li>List concrete, verifiable outcomes.</li>
  </ul>

  <h1>Non-goals</h1>
  <ul>
    <li>List explicit exclusions.</li>
  </ul>

  <h1>Human-required Gates</h1>
  <ul>
    <li>List decisions that must stop the loop for human approval.</li>
  </ul>
</body>
</html>
"#,
        escape_html(&objective)
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn ensure_dir(path: PathBuf) -> Result<()> {
    fs::create_dir_all(&path).with_context(|| format!("create {}", path.display()))
}

fn write_new(path: PathBuf, content: String, force: bool) -> Result<()> {
    if path.exists() && !force {
        return Ok(());
    }
    fs::write(&path, content).with_context(|| format!("write {}", path.display()))
}

fn pretty_json<T: Serialize>(value: &T) -> Result<String> {
    Ok(format!("{}\n", serde_json::to_string_pretty(value)?))
}

fn read_policy(root: &Path) -> Result<LoopPolicy> {
    let raw = fs::read_to_string(root.join(POLICY_PATH)).context("read LOOP_POLICY.json")?;
    serde_json::from_str(&raw).context("parse LOOP_POLICY.json")
}

fn read_tasks(root: &Path) -> Result<TaskLedger> {
    let raw = fs::read_to_string(root.join(TASKS_PATH)).context("read TASKS.json")?;
    serde_json::from_str(&raw).context("parse TASKS.json")
}

fn read_adapters(root: &Path) -> Result<AdapterCatalog> {
    let raw = fs::read_to_string(root.join(ADAPTERS_PATH)).context("read ADAPTERS.json")?;
    serde_json::from_str(&raw).context("parse ADAPTERS.json")
}

fn goal_hash(root: &Path) -> Result<String> {
    let bytes = fs::read(root.join(GOAL_PATH)).context("read GOAL.html")?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(hex::encode(hasher.finalize()))
}

fn goal_integrity(root: &Path) -> Result<String> {
    let expected = fs::read_to_string(root.join(GOAL_HASH_PATH))
        .context("read .yoloop/goal.sha256")?
        .trim()
        .to_string();
    let actual = goal_hash(root)?;
    if expected == actual {
        Ok("hash matches".to_string())
    } else {
        bail!("GOAL.html hash mismatch: expected {expected}, actual {actual}")
    }
}

fn append_event(root: &Path, event: Event) -> Result<()> {
    let path = root.join(EVENTS_PATH);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .with_context(|| format!("open {}", path.display()))?;
    writeln!(file, "{}", serde_json::to_string(&event)?)
        .with_context(|| format!("append {}", path.display()))
}

fn next_claimable_task(ledger: &TaskLedger) -> Option<&Task> {
    ledger
        .tasks
        .iter()
        .filter(|task| task.status == TaskStatus::Pending)
        .min_by_key(|task| task.priority)
}

fn parse_task_status(status: &str) -> Result<TaskStatus> {
    match status {
        "pending" => Ok(TaskStatus::Pending),
        "in_progress" | "in-progress" => Ok(TaskStatus::InProgress),
        "critic_review" | "critic-review" => Ok(TaskStatus::CriticReview),
        "completed" => Ok(TaskStatus::Completed),
        "cancelled" | "canceled" => Ok(TaskStatus::Cancelled),
        "blocked" => Ok(TaskStatus::Blocked),
        _ => bail!(
            "invalid task status `{status}`; expected pending, in_progress, critic_review, completed, cancelled, or blocked"
        ),
    }
}

impl AgentRole {
    fn as_str(self) -> &'static str {
        match self {
            AgentRole::Worker => "worker",
            AgentRole::Critic => "critic",
            AgentRole::GrandJury => "grand-jury",
        }
    }
}

fn render_adapter_args(root: &Path, adapter: &AgentAdapter, role: AgentRole) -> Vec<String> {
    let args = match role {
        AgentRole::Worker => &adapter.worker_args,
        AgentRole::Critic => &adapter.critic_args,
        AgentRole::GrandJury => &adapter.grand_jury_args,
    };

    args.iter()
        .map(|arg| render_template(root, arg, role))
        .collect()
}

fn render_template(root: &Path, value: &str, role: AgentRole) -> String {
    let replacements = [
        ("{{root}}", root.to_string_lossy().to_string()),
        ("{{role}}", role.as_str().to_string()),
        ("{{goal}}", GOAL_PATH.to_string()),
        ("{{policy}}", POLICY_PATH.to_string()),
        ("{{tasks}}", TASKS_PATH.to_string()),
        ("{{adapters}}", ADAPTERS_PATH.to_string()),
        ("{{plan}}", PLAN_PATH.to_string()),
        ("{{worker_prompt}}", WORKER_PROMPT_PATH.to_string()),
        ("{{critic_prompt}}", CRITIC_PROMPT_PATH.to_string()),
        ("{{progress}}", PROGRESS_PATH.to_string()),
        ("{{failures}}", FAILURES_PATH.to_string()),
        ("{{decisions}}", DECISIONS_PATH.to_string()),
    ];

    replacements
        .iter()
        .fold(value.to_string(), |rendered, (needle, replacement)| {
            rendered.replace(needle, replacement)
        })
}

fn format_command(command: &str, args: &[String]) -> String {
    std::iter::once(shell_quote(command))
        .chain(args.iter().map(|arg| shell_quote(arg)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn shell_quote(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '/' | '\\' | ':'))
    {
        value.to_string()
    } else {
        format!("\"{}\"", value.replace('"', "\\\""))
    }
}

fn is_mutating_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "Bash" | "Write" | "Edit" | "MultiEdit" | "NotebookEdit"
    )
}

fn hook_file_path(hook: &HookInput) -> Option<String> {
    hook.tool_input
        .get("file_path")
        .or_else(|| hook.tool_input.get("notebook_path"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn normalize_path_for_policy(root: &Path, path: &str) -> String {
    let raw = PathBuf::from(path);
    let rel = if raw.is_absolute() {
        raw.strip_prefix(root).unwrap_or(&raw).to_path_buf()
    } else {
        raw
    };
    rel.to_string_lossy().replace('\\', "/")
}

fn path_matches_any(path: &str, patterns: &[String]) -> bool {
    let normalized = trim_dot(path);
    patterns
        .iter()
        .map(|pattern| trim_dot(pattern))
        .any(|pattern| normalized == pattern)
}

fn path_matches_any_prefix(path: &str, roots: &[String]) -> bool {
    let normalized = trim_dot(path);
    roots.iter().map(|root| trim_dot(root)).any(|root| {
        root == "."
            || normalized == root
            || normalized
                .strip_prefix(&root)
                .map(|rest| rest.starts_with('/'))
                .unwrap_or(false)
    })
}

fn trim_dot(value: &str) -> String {
    let value = value.replace('\\', "/");
    value
        .strip_prefix("./")
        .unwrap_or(&value)
        .trim_end_matches('/')
        .to_string()
}
