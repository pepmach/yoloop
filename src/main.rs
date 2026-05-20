mod adapters;
mod app;
mod cli;
mod fsio;
mod hooks;
mod models;
mod paths;
mod tasks;
mod templates;
mod verdicts;

use anyhow::{Context, Result};
use clap::Parser;
use cli::{Cli, Command, CriticCommand, TaskCommand};

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
        Command::Init { goal, force } => app::init(&root, goal, force),
        Command::Status => app::status(&root),
        Command::Doctor => app::doctor(&root),
        Command::Pause { actor } => app::set_active(&root, false, &actor),
        Command::Resume { actor } => {
            fsio::goal_integrity(&root)?;
            app::set_active(&root, true, &actor)
        }
        Command::AcceptGoal { actor } => app::accept_goal(&root, &actor),
        Command::ClaimNext { worker } => tasks::claim_next(&root, &worker),
        Command::Run {
            adapter,
            role,
            execute,
        } => adapters::run_adapter(&root, &adapter, role, execute),
        Command::Task { command } => match command {
            TaskCommand::SetStatus {
                id,
                status,
                actor,
                message,
            } => tasks::set_task_status(&root, &id, &status, &actor, &message),
        },
        Command::Critic { command } => match command {
            CriticCommand::WriteVerdict {
                task_id,
                verdict,
                summary,
                check,
                gap,
                actor,
            } => verdicts::write_critic_verdict(
                &root, &task_id, verdict, &summary, &check, gap, &actor,
            ),
        },
        Command::Hook { command } => match command {
            cli::HookCommand::Pretooluse => hooks::pretooluse(&root),
        },
    }
}
