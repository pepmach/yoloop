use crate::{
    fsio::{append_event, ensure_dir, pretty_json},
    models::{CheckStatus, CriticVerdict, Event, VerdictCheck, VerdictDecision},
    paths::CRITIC_VERDICTS_DIR,
    tasks,
};
use anyhow::{bail, Context, Result};
use chrono::Utc;
use serde_json::json;
use std::{collections::BTreeMap, fs, path::Path};

pub(crate) fn write_critic_verdict(
    root: &Path,
    task_id: &str,
    verdict: VerdictDecision,
    summary: &str,
    check_args: &[String],
    gaps: Vec<String>,
    actor: &str,
) -> Result<()> {
    tasks::ensure_task_exists(root, task_id)?;
    ensure_dir(root.join(CRITIC_VERDICTS_DIR))?;

    let checks = check_args
        .iter()
        .map(|arg| parse_verdict_check_arg(arg))
        .collect::<Result<Vec<_>>>()?;

    let verdict_doc = CriticVerdict {
        schema_version: 1,
        task_id: task_id.to_string(),
        verdict,
        summary: summary.to_string(),
        checks,
        gaps,
        created_at: Utc::now(),
    };

    let safe_task_id = safe_file_id(task_id);
    let timestamp = verdict_doc.created_at.format("%Y%m%dT%H%M%SZ");
    let verdict_path = root
        .join(CRITIC_VERDICTS_DIR)
        .join(format!("{safe_task_id}-{timestamp}.json"));
    let latest_path = latest_verdict_path(root, task_id);
    let payload = pretty_json(&verdict_doc)?;
    fs::write(&verdict_path, &payload)
        .with_context(|| format!("write {}", verdict_path.display()))?;
    fs::write(&latest_path, payload).with_context(|| format!("write {}", latest_path.display()))?;

    let mut data = BTreeMap::new();
    data.insert("verdict".to_string(), json!(verdict.as_str()));
    data.insert(
        "latestPath".to_string(),
        json!(latest_verdict_relative_path(task_id)),
    );
    append_event(
        root,
        Event {
            timestamp: Utc::now(),
            kind: "critic.verdict_written".to_string(),
            actor: actor.to_string(),
            task_id: Some(task_id.to_string()),
            message: format!("Critic verdict for {task_id}: {}", verdict.as_str()),
            data,
        },
    )?;

    println!("wrote {}", latest_path.display());
    Ok(())
}

pub(crate) fn ensure_latest_verdict_approved(root: &Path, task_id: &str) -> Result<()> {
    let verdict = read_latest_verdict(root, task_id).with_context(|| {
        format!("task {task_id} cannot complete without an approved critic verdict")
    })?;
    if verdict.task_id != task_id {
        bail!(
            "latest critic verdict task mismatch: expected {task_id}, got {}",
            verdict.task_id
        );
    }
    if verdict.verdict != VerdictDecision::Approved {
        bail!(
            "latest critic verdict for task {task_id} is {}, not approved",
            verdict.verdict.as_str()
        );
    }
    Ok(())
}

fn read_latest_verdict(root: &Path, task_id: &str) -> Result<CriticVerdict> {
    let path = latest_verdict_path(root, task_id);
    let raw = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))
}

fn latest_verdict_path(root: &Path, task_id: &str) -> std::path::PathBuf {
    root.join(latest_verdict_relative_path(task_id))
}

fn latest_verdict_relative_path(task_id: &str) -> String {
    format!(
        "{}/{}.latest.json",
        CRITIC_VERDICTS_DIR,
        safe_file_id(task_id)
    )
}

fn parse_verdict_check_arg(raw: &str) -> Result<VerdictCheck> {
    let (name, rest) = raw
        .split_once('=')
        .with_context(|| format!("invalid check {raw:?}; expected name=status:evidence"))?;
    let (status, evidence) = rest
        .split_once(':')
        .with_context(|| format!("invalid check {raw:?}; expected name=status:evidence"))?;
    Ok(VerdictCheck {
        name: name.trim().to_string(),
        status: parse_check_status(status)?,
        evidence: evidence.trim().to_string(),
    })
}

fn parse_check_status(status: &str) -> Result<CheckStatus> {
    match status
        .trim()
        .to_ascii_lowercase()
        .replace('-', "_")
        .as_str()
    {
        "passed" => Ok(CheckStatus::Passed),
        "failed" => Ok(CheckStatus::Failed),
        "skipped" => Ok(CheckStatus::Skipped),
        other => bail!("unknown check status {other}"),
    }
}

fn safe_file_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_verdict_check_arg() {
        let check = parse_verdict_check_arg("cargo check=passed:clean").unwrap();
        assert_eq!(check.name, "cargo check");
        assert_eq!(check.status, CheckStatus::Passed);
        assert_eq!(check.evidence, "clean");
    }

    #[test]
    fn completed_status_requires_approved_verdict() {
        let root = std::env::temp_dir().join(format!(
            "yoloop-verdict-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        fs::create_dir_all(root.join(CRITIC_VERDICTS_DIR)).unwrap();

        assert!(ensure_latest_verdict_approved(&root, "T-1").is_err());

        let rejected = CriticVerdict {
            schema_version: 1,
            task_id: "T-1".to_string(),
            verdict: VerdictDecision::Rejected,
            summary: "not yet".to_string(),
            checks: vec![],
            gaps: vec![],
            created_at: Utc::now(),
        };
        fs::write(
            latest_verdict_path(&root, "T-1"),
            serde_json::to_string_pretty(&rejected).unwrap(),
        )
        .unwrap();
        assert!(ensure_latest_verdict_approved(&root, "T-1").is_err());

        let approved = CriticVerdict {
            verdict: VerdictDecision::Approved,
            ..rejected
        };
        fs::write(
            latest_verdict_path(&root, "T-1"),
            serde_json::to_string_pretty(&approved).unwrap(),
        )
        .unwrap();
        assert!(ensure_latest_verdict_approved(&root, "T-1").is_ok());

        let _ = fs::remove_dir_all(root);
    }
}
