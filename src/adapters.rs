use crate::{
    fsio::{append_event, ensure_dir, goal_integrity, read_adapters},
    models::{AgentAdapter, AgentRole, Event},
    paths::{
        ADAPTERS_PATH, CRITIC_PROMPT_PATH, DECISIONS_PATH, FAILURES_PATH, GOAL_PATH, PLAN_PATH,
        POLICY_PATH, PROGRESS_PATH, RAW_DIR, RUNS_DIR, TASKS_PATH, WORKER_PROMPT_PATH,
    },
};
use anyhow::{bail, Context, Result};
use chrono::Utc;
use serde_json::json;
use std::{collections::BTreeMap, fs, path::Path, process::Command as ProcessCommand};

pub(crate) fn run_adapter(
    root: &Path,
    adapter_id: &str,
    role: AgentRole,
    execute: bool,
) -> Result<()> {
    goal_integrity(root)?;
    let catalog = read_adapters(root)?;
    let adapter = catalog
        .adapters
        .iter()
        .find(|candidate| candidate.id == adapter_id)
        .with_context(|| format!("adapter {adapter_id} not found in {ADAPTERS_PATH}"))?;
    let args = render_adapter_args(adapter, role);
    let rendered_command = format_command(&adapter.command, &args);

    if !execute {
        println!("dry run: {rendered_command}");
        return Ok(());
    }

    ensure_dir(root.join(RUNS_DIR))?;
    let run_id = format!(
        "{}-{}-{}",
        adapter.id,
        role.as_str(),
        Utc::now().format("%Y%m%dT%H%M%SZ")
    );

    let mut data = BTreeMap::new();
    data.insert("adapter".to_string(), json!(adapter.id));
    data.insert("role".to_string(), json!(role.as_str()));
    data.insert("command".to_string(), json!(rendered_command));
    data.insert("runId".to_string(), json!(run_id));
    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: "adapter.run_started".to_string(),
            actor: "yoloop".to_string(),
            task_id: None,
            message: format!("Started adapter {} as {}.", adapter.id, role.as_str()),
            data,
        },
    )?;

    let output = ProcessCommand::new(&adapter.command)
        .args(&args)
        .current_dir(root)
        .output()
        .with_context(|| format!("run {rendered_command}"))?;

    let stdout_path = root.join(RUNS_DIR).join(format!("{run_id}.stdout.txt"));
    let stderr_path = root.join(RUNS_DIR).join(format!("{run_id}.stderr.txt"));
    fs::write(&stdout_path, output.stdout)
        .with_context(|| format!("write {}", stdout_path.display()))?;
    fs::write(&stderr_path, output.stderr)
        .with_context(|| format!("write {}", stderr_path.display()))?;

    let mut data = BTreeMap::new();
    data.insert("adapter".to_string(), json!(adapter.id));
    data.insert("role".to_string(), json!(role.as_str()));
    data.insert("runId".to_string(), json!(run_id));
    data.insert("exitCode".to_string(), json!(output.status.code()));
    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: "adapter.run_finished".to_string(),
            actor: "yoloop".to_string(),
            task_id: None,
            message: format!("Finished adapter {} as {}.", adapter.id, role.as_str()),
            data,
        },
    )?;

    if !output.status.success() {
        bail!("adapter exited with status {}", output.status);
    }

    Ok(())
}

fn render_adapter_args(adapter: &AgentAdapter, role: AgentRole) -> Vec<String> {
    let args = match role {
        AgentRole::Worker => &adapter.worker_args,
        AgentRole::Critic => &adapter.critic_args,
        AgentRole::GrandJury => &adapter.grand_jury_args,
    };
    args.iter().map(|arg| render_template(arg)).collect()
}

fn render_template(value: &str) -> String {
    value
        .replace("{{goal}}", GOAL_PATH)
        .replace("{{policy}}", POLICY_PATH)
        .replace("{{plan}}", PLAN_PATH)
        .replace("{{tasks}}", TASKS_PATH)
        .replace("{{worker_prompt}}", WORKER_PROMPT_PATH)
        .replace("{{critic_prompt}}", CRITIC_PROMPT_PATH)
        .replace("{{progress}}", PROGRESS_PATH)
        .replace("{{failures}}", FAILURES_PATH)
        .replace("{{decisions}}", DECISIONS_PATH)
        .replace("{{raw}}", RAW_DIR)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_raw_placeholder() {
        assert_eq!(
            render_template("read {{raw}} and {{goal}}"),
            "read raw and GOAL.html"
        );
    }
}
