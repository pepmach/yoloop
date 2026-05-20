use crate::{
    fsio::{
        append_event, ensure_dir, goal_hash, goal_integrity, pretty_json, read_adapters,
        read_policy, read_tasks, write_new,
    },
    models::{Event, LoopPolicy, TaskStatus},
    paths::{
        ADAPTERS_PATH, CRITIC_PROMPT_PATH, CRITIC_VERDICTS_DIR, DECISIONS_PATH, EVENTS_PATH,
        FAILURES_PATH, GOAL_HASH_PATH, GOAL_PATH, PLAN_PATH, POLICY_PATH, PROGRESS_PATH, RAW_DIR,
        TASKS_PATH, WORKER_PROMPT_PATH, YOLOOP_DIR,
    },
    tasks, templates,
};
use anyhow::{Context, Result};
use chrono::Utc;
use serde_json::json;
use std::{collections::BTreeMap, fs, path::Path};

pub(crate) fn init(root: &Path, goal: Option<String>, force: bool) -> Result<()> {
    ensure_dir(root.join(YOLOOP_DIR))?;
    ensure_dir(root.join(CRITIC_VERDICTS_DIR))?;
    ensure_dir(root.join(RAW_DIR))?;

    let objective =
        goal.unwrap_or_else(|| "Describe the goal here before launching the loop.".to_string());
    write_new(root.join(GOAL_PATH), templates::goal_html(objective), force)?;
    write_new(
        root.join(POLICY_PATH),
        pretty_json(&templates::default_policy())?,
        force,
    )?;
    write_new(
        root.join(TASKS_PATH),
        pretty_json(&templates::default_tasks())?,
        force,
    )?;
    write_new(
        root.join(ADAPTERS_PATH),
        pretty_json(&templates::default_adapters())?,
        force,
    )?;
    write_new(root.join(PLAN_PATH), templates::default_plan(), force)?;
    write_new(
        root.join(WORKER_PROMPT_PATH),
        templates::default_worker_prompt(),
        force,
    )?;
    write_new(
        root.join(CRITIC_PROMPT_PATH),
        templates::default_critic_prompt(),
        force,
    )?;
    write_new(
        root.join(PROGRESS_PATH),
        templates::empty_log_html("Progress"),
        force,
    )?;
    write_new(
        root.join(FAILURES_PATH),
        templates::empty_log_html("Failures"),
        force,
    )?;
    write_new(
        root.join(DECISIONS_PATH),
        templates::empty_log_html("Decisions"),
        force,
    )?;
    write_new(root.join(EVENTS_PATH), String::new(), force)?;

    if force || !root.join(GOAL_HASH_PATH).exists() {
        fs::write(root.join(GOAL_HASH_PATH), format!("{}\n", goal_hash(root)?))
            .context("write .yoloop/goal.sha256")?;
    }

    let mut data = BTreeMap::new();
    data.insert("rawDir".to_string(), json!(RAW_DIR));
    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: "harness.initialized".to_string(),
            actor: "yoloop".to_string(),
            task_id: None,
            message: "Initialized Yoloop harness files.".to_string(),
            data,
        },
    )?;

    println!("initialized yoloop in {}", root.display());
    println!("put supporting context in {}", root.join(RAW_DIR).display());
    println!("edit GOAL.html, PLAN.html, TASKS.json, and LOOP_POLICY.json before launching agents");
    Ok(())
}

pub(crate) fn status(root: &Path) -> Result<()> {
    let policy = read_policy(root)?;
    let ledger = read_tasks(root)?;
    let goal_status = match goal_integrity(root) {
        Ok(message) => message,
        Err(err) => format!("FAILED: {err:#}"),
    };

    let mut pending = 0;
    let mut in_progress = 0;
    let mut critic_review = 0;
    let mut completed = 0;
    let mut cancelled = 0;
    let mut blocked = 0;

    for task in &ledger.tasks {
        match task.status {
            TaskStatus::Pending => pending += 1,
            TaskStatus::InProgress => in_progress += 1,
            TaskStatus::CriticReview => critic_review += 1,
            TaskStatus::Completed => completed += 1,
            TaskStatus::Cancelled => cancelled += 1,
            TaskStatus::Blocked => blocked += 1,
        }
    }

    println!("active: {}", policy.active);
    println!("goal: {goal_status}");
    println!("raw context files: {}", raw_context_file_count(root)?);
    println!("tasks: {} total", ledger.tasks.len());
    println!("  pending: {pending}");
    println!("  in_progress: {in_progress}");
    println!("  critic_review: {critic_review}");
    println!("  completed: {completed}");
    println!("  blocked: {blocked}");
    println!("  cancelled: {cancelled}");

    if let Some(task) = tasks::next_claimable_task(&ledger) {
        println!("next claimable task: {} - {}", task.id, task.title);
    } else {
        println!("next claimable task: none");
    }

    Ok(())
}

pub(crate) fn doctor(root: &Path) -> Result<()> {
    let required_files = [
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
    let required_dirs = [YOLOOP_DIR, RAW_DIR, CRITIC_VERDICTS_DIR];

    for path in required_dirs {
        let full_path = root.join(path);
        if !full_path.is_dir() {
            anyhow::bail!("missing required directory {}", full_path.display());
        }
    }

    for path in required_files {
        let full_path = root.join(path);
        if !full_path.is_file() {
            anyhow::bail!("missing required file {}", full_path.display());
        }
    }

    let _: LoopPolicy = read_policy(root)?;
    let _ = read_tasks(root)?;
    let _ = read_adapters(root)?;
    goal_integrity(root)?;

    println!("doctor: ok");
    println!("raw context files: {}", raw_context_file_count(root)?);
    Ok(())
}

pub(crate) fn set_active(root: &Path, active: bool, actor: &str) -> Result<()> {
    let mut policy = read_policy(root)?;
    policy.active = active;
    fs::write(root.join(POLICY_PATH), pretty_json(&policy)?).context("write LOOP_POLICY.json")?;

    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: if active {
                "policy.resumed"
            } else {
                "policy.paused"
            }
            .to_string(),
            actor: actor.to_string(),
            task_id: None,
            message: if active {
                "Loop policy resumed.".to_string()
            } else {
                "Loop policy paused.".to_string()
            },
            data: BTreeMap::new(),
        },
    )?;

    println!("active: {active}");
    Ok(())
}

pub(crate) fn accept_goal(root: &Path, actor: &str) -> Result<()> {
    let hash = goal_hash(root)?;
    fs::write(root.join(GOAL_HASH_PATH), format!("{hash}\n"))
        .context("write .yoloop/goal.sha256")?;

    let mut data = BTreeMap::new();
    data.insert("goalSha256".to_string(), json!(hash));
    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: "goal.accepted".to_string(),
            actor: actor.to_string(),
            task_id: None,
            message: "Accepted current GOAL.html hash.".to_string(),
            data,
        },
    )?;

    println!("accepted GOAL.html");
    Ok(())
}

fn raw_context_file_count(root: &Path) -> Result<usize> {
    let raw_path = root.join(RAW_DIR);
    if !raw_path.exists() {
        return Ok(0);
    }

    let mut count = 0;
    let mut stack = vec![raw_path];
    while let Some(path) = stack.pop() {
        for entry in fs::read_dir(&path).with_context(|| format!("read {}", path.display()))? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                stack.push(entry.path());
            } else if file_type.is_file() {
                count += 1;
            }
        }
    }
    Ok(count)
}
