use crate::models::{AgentRole, VerdictDecision};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "yoloop")]
#[command(about = "Durable agent-loop harness for long-running coding agents")]
pub(crate) struct Cli {
    #[command(subcommand)]
    pub(crate) command: Command,
}

#[derive(Subcommand)]
pub(crate) enum Command {
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

    /// Critic verdict operations.
    Critic {
        #[command(subcommand)]
        command: CriticCommand,
    },

    /// Hook entrypoints used by Claude Code or other agent hosts.
    Hook {
        #[command(subcommand)]
        command: HookCommand,
    },
}

#[derive(Subcommand)]
pub(crate) enum HookCommand {
    /// Claude Code PreToolUse policy hook. Reads hook JSON from stdin.
    Pretooluse,
}

#[derive(Subcommand)]
pub(crate) enum TaskCommand {
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

#[derive(Subcommand)]
pub(crate) enum CriticCommand {
    /// Write the latest structured critic verdict for a task.
    WriteVerdict {
        #[arg(long)]
        task_id: String,

        #[arg(long, value_enum)]
        verdict: VerdictDecision,

        #[arg(long)]
        summary: String,

        /// Check entry as name=status:evidence, e.g. "cargo check=passed:clean".
        #[arg(long)]
        check: Vec<String>,

        /// Known gap or residual concern.
        #[arg(long)]
        gap: Vec<String>,

        #[arg(long, default_value = "critic")]
        actor: String,
    },
}
