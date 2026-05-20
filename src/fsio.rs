use crate::{
    models::{AdapterCatalog, Event, LoopPolicy, TaskLedger},
    paths::{ADAPTERS_PATH, EVENTS_PATH, GOAL_HASH_PATH, GOAL_PATH, POLICY_PATH, TASKS_PATH},
};
use anyhow::{bail, Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub(crate) fn ensure_dir(path: PathBuf) -> Result<()> {
    fs::create_dir_all(&path).with_context(|| format!("create {}", path.display()))
}

pub(crate) fn write_new(path: PathBuf, content: String, force: bool) -> Result<()> {
    if path.exists() && !force {
        return Ok(());
    }
    fs::write(&path, content).with_context(|| format!("write {}", path.display()))
}

pub(crate) fn pretty_json<T: Serialize>(value: &T) -> Result<String> {
    Ok(format!("{}\n", serde_json::to_string_pretty(value)?))
}

pub(crate) fn read_policy(root: &Path) -> Result<LoopPolicy> {
    let raw = fs::read_to_string(root.join(POLICY_PATH)).context("read LOOP_POLICY.json")?;
    serde_json::from_str(&raw).context("parse LOOP_POLICY.json")
}

pub(crate) fn read_tasks(root: &Path) -> Result<TaskLedger> {
    let raw = fs::read_to_string(root.join(TASKS_PATH)).context("read TASKS.json")?;
    serde_json::from_str(&raw).context("parse TASKS.json")
}

pub(crate) fn read_adapters(root: &Path) -> Result<AdapterCatalog> {
    let raw = fs::read_to_string(root.join(ADAPTERS_PATH)).context("read ADAPTERS.json")?;
    serde_json::from_str(&raw).context("parse ADAPTERS.json")
}

pub(crate) fn goal_hash(root: &Path) -> Result<String> {
    let bytes = fs::read(root.join(GOAL_PATH)).context("read GOAL.html")?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(hex::encode(hasher.finalize()))
}

pub(crate) fn goal_integrity(root: &Path) -> Result<String> {
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

pub(crate) fn append_event(root: &Path, event: Event) -> Result<()> {
    let path = root.join(EVENTS_PATH);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .with_context(|| format!("open {}", path.display()))?;
    writeln!(file, "{}", serde_json::to_string(&event)?)
        .with_context(|| format!("append {}", path.display()))
}
