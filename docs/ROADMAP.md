# Yoloop Roadmap

This roadmap reflects the current product direction, not only the current implementation. Human-facing runtime artifacts are Markdown-primary, while JSON/JSONL remains the enforcement layer.

## v0.1: Control Plane

Status: implemented baseline.

- Initialize durable harness files.
- Generate harness artifacts with deterministic `orchestrate`.
- Create `raw/` as the user-owned context folder.
- Enforce immutable goal and protected policy files through `PreToolUse`.
- Track tasks through `TASKS.json`.
- Track host command templates through `ADAPTERS.json`.
- Track machine events through `.yoloop/events.jsonl`.
- Provide the first host adapter as a thin Claude Code plugin wrapper.

## v0.2: Local Runner

Status: implemented baseline.

- Add `yoloop run`.
- Make `yoloop run` execute the sequential worker-critic loop.
- Add `yoloop run --dry-run` for preview.
- Spawn one fresh worker session per task attempt.
- Spawn one fresh critic session after each worker handoff.
- Support configurable command templates for Claude Code, Codex, and other agent hosts.
- Capture stdout, stderr, exit code, duration, and transcript paths into `.yoloop/runs/` and events.
- Stop on human gates, budget exhaustion, or critic rejection threshold.

## v0.3: Verdict Enforcement And Human Logs

Status: implemented baseline.

- Add `yoloop critic write-verdict`.
- Add `yoloop grand-jury write-verdict`.
- Add `yoloop log append` for curated append-only human logs.
- Validate verdicts against Zod schemas.
- Only allow `completed` transitions when the latest verdict is `approved`.
- Emit final `<yoloop-done>` only when the latest grand jury verdict is `approved`.
- Require deterministic check evidence for approval.
- Store canonical human logs in `.yoloop/human-log.jsonl`.
- Render `PROGRESS.md`, `FAILURES.md`, and `DECISIONS.md` from structured log entries.

## v0.4: Markdown Artifact Pivot

Status: implemented baseline.

- Replace runtime human artifacts with `GOAL.md`, `PLAN.md`, `WORKER_PROMPT.md`, `CRITIC_PROMPT.md`, `PROGRESS.md`, `FAILURES.md`, and `DECISIONS.md`.
- Add `DECOMPOSITION_REVIEW.md` and `REPORT.md`.
- Update goal hash enforcement to `GOAL.md`.
- Update hooks to protect Markdown artifacts and canonical JSONL state.
- Update adapter placeholders and prompts.
- Keep optional HTML reports out of the core path until preview friction is solved.

## v0.5: Installability And Host Setup

- Verify npm package name availability for `yoloop`.
- If unavailable, prepare scoped publication such as `@pepmach/yoloop`.
- Add release/package metadata needed for npm publication.
- Add `yoloop install claude|codex|auto`.
- Install or link the Claude Code plugin surface and verify hooks.
- Install or link the Codex skill/plugin surface where supported.
- Document manual fallback paths.
- Keep Cursor and OpenCode as future TODOs after Claude Code and Codex are reliable.

## v0.6: Wizard, Doctor, And Context Manifest

- Add guided `yoloop orchestrate --wizard` or equivalent setup command.
- Ask for objective, scope, success criteria, non-goals, human gates, milestone strategy, and build/test/check instructions.
- Preserve non-interactive flags for agents and automation.
- Run doctor-style preflight before each loop start.
- Validate configured checks before execution.
- Detect package manager, build, lint, typecheck, test, and integration commands when user instructions are absent.
- Create `.yoloop/context-manifest.json` from `raw/` with paths, sizes, hashes, and file types.

## v0.7: Decomposition Critic

- Add a blocking decomposition review stage after orchestration and before workers.
- Write structured verdicts under `.yoloop/decomposition-verdicts/`.
- Render `DECOMPOSITION_REVIEW.md`.
- Require every task to have concrete success criteria, milestone ID, expected checks or a no-check reason, valid dependencies, scoped ownership, and risk level.
- Reject task ledgers that violate non-goals, omit human gates, mix unrelated milestones, or create tasks too large for one worker session.
- Make `yoloop run` refuse worker execution without an approved decomposition verdict for the current goal, plan, policy, and task ledger hashes.

## v0.8: Decision Queue And Reports

- Add `.yoloop/decision-queue.json`.
- Render human gates as a Codex-style queue with generated options, recommendation, freeform answer path, and chat-about-this escape hatch.
- Add `yoloop report`.
- Write Markdown reports before terminal states: done, human review needed, failed, timed out, or budget exhausted.
- Include task state, checks, failures, decisions, verdicts, open gates, milestone status, and next safe command.

## v0.9: Milestone Commits And PR Body

- Add milestone IDs and metadata to task planning.
- Prepare local commits when a milestone is complete and approved.
- Generate PR body sections from milestones, checks, failures, decisions, and final verdicts.
- Do not auto-push or open remote PRs by default.

## v1.0: Overnight Mode

- End-to-end `yoloop run` with Markdown artifacts, decomposition gate, sequential worker/critic repair loop, grand jury, decision queue, and final report.
- Installable Claude Code and Codex surfaces.
- Restart-safe run state.
- Configurable role-specific model policy.
- Fresh one-shot sessions for worker, critic, repair, decomposition critic, and grand jury roles.
- Final `<yoloop-done>` emission only after grand jury approval.

## Later

- Explore persistent or hybrid adapter sessions only as opt-in performance experiments after the one-shot loop is stable.
- Add worktree isolation.
- Add bounded parallel workers only after sequential mode is reliable.
- Add integration critics and merge policy.
- Add optional HTML dashboards or rich generated reports.
- Add Cursor and OpenCode integrations.
