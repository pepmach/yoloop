use crate::{
    fsio::{goal_integrity, read_policy},
    models::HookInput,
};
use anyhow::{Context, Result};
use serde_json::json;
use std::{
    io::{self, Read},
    path::{Path, PathBuf},
};

pub(crate) fn pretooluse(root: &Path) -> Result<()> {
    let mut raw = String::new();
    io::stdin()
        .read_to_string(&mut raw)
        .context("read hook stdin")?;
    if raw.trim().is_empty() {
        return approve();
    }

    let input: HookInput = serde_json::from_str(&raw).context("parse hook input")?;
    let policy = read_policy(root)?;
    if !policy.active {
        return approve();
    }

    if is_mutating_tool(&input.tool_name) {
        if let Err(err) = goal_integrity(root) {
            return deny(format!("GOAL.html changed while loop is active: {err:#}"));
        }
    }

    if input.tool_name.eq_ignore_ascii_case("bash") {
        if let Some(command) = input
            .tool_input
            .get("command")
            .and_then(|value| value.as_str())
        {
            let lower_command = command.to_ascii_lowercase();
            for denied in &policy.deny_shell_substrings {
                if lower_command.contains(&denied.to_ascii_lowercase()) {
                    return deny(format!("command contains denied substring {denied:?}"));
                }
            }
        }
    }

    for path in hook_file_paths(root, &input) {
        let normalized = normalize_path_for_policy(root, &path);
        if path_matches_any(&normalized, &policy.immutable_paths) {
            return deny(format!("{normalized} is immutable while yoloop is active"));
        }
        if path_matches_any(&normalized, &policy.protected_paths_while_active) {
            return deny(format!("{normalized} is protected while yoloop is active"));
        }
    }

    approve()
}

fn approve() -> Result<()> {
    println!("{}", json!({ "decision": "approve" }));
    Ok(())
}

fn deny(reason: String) -> Result<()> {
    println!("{}", json!({ "decision": "block", "reason": reason }));
    Ok(())
}

fn is_mutating_tool(tool_name: &str) -> bool {
    matches!(
        tool_name.to_ascii_lowercase().as_str(),
        "bash" | "write" | "edit" | "multiedit" | "notebookedit"
    )
}

fn hook_file_paths(root: &Path, input: &HookInput) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for key in ["file_path", "path", "notebook_path"] {
        if let Some(path) = input.tool_input.get(key).and_then(|value| value.as_str()) {
            paths.push(resolve_hook_path(root, path));
        }
    }
    paths
}

fn resolve_hook_path(root: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn normalize_path_for_policy(root: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    trim_dot(&relative.to_string_lossy().replace('\\', "/"))
}

fn trim_dot(value: &str) -> String {
    value
        .strip_prefix("./")
        .or_else(|| value.strip_prefix(".\\"))
        .unwrap_or(value)
        .to_string()
}

fn path_matches_any(path: &str, patterns: &[String]) -> bool {
    patterns.iter().any(|pattern| path_matches(path, pattern))
}

fn path_matches(path: &str, pattern: &str) -> bool {
    let pattern = trim_dot(&pattern.replace('\\', "/"));
    if pattern.ends_with('/') {
        return path == pattern.trim_end_matches('/') || path.starts_with(&pattern);
    }
    if !pattern.contains('*') {
        return path == pattern;
    }

    let mut remaining = path;
    let mut parts = pattern.split('*').peekable();
    if let Some(first) = parts.next() {
        if !first.is_empty() {
            let Some(rest) = remaining.strip_prefix(first) else {
                return false;
            };
            remaining = rest;
        }
    }

    while let Some(part) = parts.next() {
        if part.is_empty() {
            continue;
        }
        let Some(index) = remaining.find(part) else {
            return false;
        };
        remaining = &remaining[index + part.len()..];
        if parts.peek().is_none() && !pattern.ends_with('*') {
            return remaining.is_empty();
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_exact_and_prefix_paths() {
        assert!(path_matches("GOAL.html", "GOAL.html"));
        assert!(path_matches("migrations/001.sql", "migrations/"));
        assert!(!path_matches("src/main.rs", "GOAL.html"));
    }
}
