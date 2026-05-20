use chrono::{DateTime, Utc};
use clap::ValueEnum;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub(crate) enum AgentRole {
    Worker,
    Critic,
    GrandJury,
}

impl AgentRole {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            AgentRole::Worker => "worker",
            AgentRole::Critic => "critic",
            AgentRole::GrandJury => "grand-jury",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoopPolicy {
    pub(crate) schema_version: u32,
    pub(crate) active: bool,
    pub(crate) max_iterations: u32,
    pub(crate) max_wall_clock_minutes: u32,
    pub(crate) max_retries_per_task: u32,
    pub(crate) immutable_paths: Vec<String>,
    pub(crate) protected_paths_while_active: Vec<String>,
    pub(crate) allowed_write_roots: Vec<String>,
    pub(crate) deny_shell_substrings: Vec<String>,
    pub(crate) human_gates: Vec<HumanGate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HumanGate {
    pub(crate) id: String,
    pub(crate) description: String,
    pub(crate) path_globs: Vec<String>,
    pub(crate) command_substrings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdapterCatalog {
    pub(crate) schema_version: u32,
    pub(crate) adapters: Vec<AgentAdapter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentAdapter {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) command: String,
    pub(crate) worker_args: Vec<String>,
    pub(crate) critic_args: Vec<String>,
    pub(crate) grand_jury_args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskLedger {
    pub(crate) schema_version: u32,
    pub(crate) tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Task {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) status: TaskStatus,
    pub(crate) priority: u32,
    pub(crate) attempts: u32,
    pub(crate) claimed_by: Option<String>,
    pub(crate) depends_on: Vec<String>,
    pub(crate) allowed_paths: Vec<String>,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskStatus {
    Pending,
    InProgress,
    CriticReview,
    Completed,
    Cancelled,
    Blocked,
}

impl TaskStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            TaskStatus::Pending => "pending",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::CriticReview => "critic_review",
            TaskStatus::Completed => "completed",
            TaskStatus::Cancelled => "cancelled",
            TaskStatus::Blocked => "blocked",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "snake_case")]
pub(crate) enum VerdictDecision {
    Approved,
    Rejected,
    HumanApprovalRequired,
}

impl VerdictDecision {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            VerdictDecision::Approved => "approved",
            VerdictDecision::Rejected => "rejected",
            VerdictDecision::HumanApprovalRequired => "human_approval_required",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CheckStatus {
    Passed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CriticVerdict {
    pub(crate) schema_version: u32,
    pub(crate) task_id: String,
    pub(crate) verdict: VerdictDecision,
    pub(crate) summary: String,
    pub(crate) checks: Vec<VerdictCheck>,
    pub(crate) gaps: Vec<String>,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerdictCheck {
    pub(crate) name: String,
    pub(crate) status: CheckStatus,
    pub(crate) evidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Event {
    pub(crate) timestamp: DateTime<Utc>,
    pub(crate) kind: String,
    pub(crate) actor: String,
    pub(crate) task_id: Option<String>,
    pub(crate) message: String,
    pub(crate) data: BTreeMap<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct HookInput {
    pub(crate) tool_name: String,
    #[serde(default)]
    pub(crate) tool_input: Value,
}
