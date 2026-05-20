use crate::{
    fsio::{append_event, goal_integrity, pretty_json, read_policy, read_tasks},
    models::{Event, Task, TaskLedger, TaskStatus},
    paths::TASKS_PATH,
    verdicts,
};
use anyhow::{bail, Context, Result};
use chrono::Utc;
use serde_json::json;
use std::{collections::BTreeMap, fs, path::Path};

pub(crate) fn claim_next(root: &Path, worker: &str) -> Result<()> {
    let policy = read_policy(root)?;
    if !policy.active {
        bail!("loop is paused; resume before claiming work");
    }
    goal_integrity(root)?;

    let mut ledger = read_tasks(root)?;
    let Some(index) = next_claimable_task_index(&ledger, policy.max_retries_per_task) else {
        println!("no claimable task");
        return Ok(());
    };

    let task = &mut ledger.tasks[index];
    task.status = TaskStatus::InProgress;
    task.claimed_by = Some(worker.to_string());
    task.attempts += 1;
    task.updated_at = Utc::now();
    let task_id = task.id.clone();
    let title = task.title.clone();

    fs::write(root.join(TASKS_PATH), pretty_json(&ledger)?).context("write TASKS.json")?;

    let mut data = BTreeMap::new();
    data.insert("worker".to_string(), json!(worker));
    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: "task.claimed".to_string(),
            actor: worker.to_string(),
            task_id: Some(task_id.clone()),
            message: format!("Claimed task {task_id}."),
            data,
        },
    )?;

    println!("claimed {task_id}: {title}");
    Ok(())
}

pub(crate) fn set_task_status(
    root: &Path,
    id: &str,
    status: &str,
    actor: &str,
    message: &str,
) -> Result<()> {
    let next_status = parse_task_status(status)?;
    if next_status == TaskStatus::Completed {
        verdicts::ensure_latest_verdict_approved(root, id)?;
    }

    let mut ledger = read_tasks(root)?;
    let task = ledger
        .tasks
        .iter_mut()
        .find(|task| task.id == id)
        .with_context(|| format!("task {id} not found"))?;

    task.status = next_status;
    task.updated_at = Utc::now();
    match next_status {
        TaskStatus::Pending
        | TaskStatus::Completed
        | TaskStatus::Cancelled
        | TaskStatus::Blocked => {
            task.claimed_by = None;
        }
        TaskStatus::InProgress | TaskStatus::CriticReview => {
            if task.claimed_by.is_none() {
                task.claimed_by = Some(actor.to_string());
            }
        }
    }

    fs::write(root.join(TASKS_PATH), pretty_json(&ledger)?).context("write TASKS.json")?;

    let mut data = BTreeMap::new();
    data.insert("status".to_string(), json!(next_status.as_str()));
    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: "task.status_changed".to_string(),
            actor: actor.to_string(),
            task_id: Some(id.to_string()),
            message: if message.is_empty() {
                format!("Set task {id} to {}.", next_status.as_str())
            } else {
                message.to_string()
            },
            data,
        },
    )?;

    println!("task {id}: {}", next_status.as_str());
    Ok(())
}

pub(crate) fn ensure_task_exists(root: &Path, id: &str) -> Result<()> {
    let ledger = read_tasks(root)?;
    if ledger.tasks.iter().any(|task| task.id == id) {
        Ok(())
    } else {
        bail!("task {id} not found")
    }
}

pub(crate) fn next_claimable_task(ledger: &TaskLedger) -> Option<&Task> {
    next_claimable_task_index(ledger, u32::MAX).map(|index| &ledger.tasks[index])
}

fn next_claimable_task_index(ledger: &TaskLedger, max_retries_per_task: u32) -> Option<usize> {
    ledger
        .tasks
        .iter()
        .enumerate()
        .filter(|(_, task)| task.status == TaskStatus::Pending)
        .filter(|(_, task)| task.attempts < max_retries_per_task)
        .filter(|(_, task)| dependencies_completed(ledger, task))
        .min_by_key(|(_, task)| task.priority)
        .map(|(index, _)| index)
}

fn dependencies_completed(ledger: &TaskLedger, task: &Task) -> bool {
    task.depends_on.iter().all(|dependency| {
        ledger.tasks.iter().any(|candidate| {
            candidate.id == *dependency && candidate.status == TaskStatus::Completed
        })
    })
}

fn parse_task_status(status: &str) -> Result<TaskStatus> {
    match status
        .trim()
        .to_ascii_lowercase()
        .replace('-', "_")
        .as_str()
    {
        "pending" => Ok(TaskStatus::Pending),
        "in_progress" => Ok(TaskStatus::InProgress),
        "critic_review" => Ok(TaskStatus::CriticReview),
        "completed" => Ok(TaskStatus::Completed),
        "cancelled" | "canceled" => Ok(TaskStatus::Cancelled),
        "blocked" => Ok(TaskStatus::Blocked),
        other => bail!("unknown task status {other}"),
    }
}
