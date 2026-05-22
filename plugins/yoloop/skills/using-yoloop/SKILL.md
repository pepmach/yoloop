---
name: using-yoloop
description: Use when a user wants Codex to initialize, inspect, run, or continue a Yoloop harness in the current repository.
---

# Using Yoloop

Yoloop is a local harness for durable coding-agent loops. Treat the `yoloop` CLI as the control plane and the repo files as the source of truth.

## When To Use

Use this skill when the user asks to:

- set up Yoloop for a repository;
- run or preview an overnight worker-critic loop;
- inspect Yoloop task, policy, progress, failure, decision, critic, or grand-jury state;
- continue work from existing Yoloop artifacts.

## Operating Rules

1. Run `yoloop doctor` before starting or resuming a loop.
2. Use `yoloop context refresh` after the user adds or changes files under `raw/`.
3. Never edit `GOAL.md` while the loop is active. If the goal must change, run `yoloop pause`, ask the user to edit `GOAL.md`, then run `yoloop accept-goal` and `yoloop resume` only after approval.
4. Never directly edit `PROGRESS.md`, `FAILURES.md`, or `DECISIONS.md`. Append curated entries with `yoloop log append`.
5. Make sure the current decomposition verdict is approved before launching workers. Use `yoloop decomposition write-verdict` after reviewing task contracts.
6. Use `yoloop run --dry-run` before launching a real loop unless the user explicitly asked to run immediately.
7. Use `yoloop run` for the sequential loop. Use `yoloop adapter run --role worker|critic|grand-jury --dry-run` only for adapter diagnostics.
8. Stop and ask for human approval before dependency, auth, migration, secret, deploy, or broad architecture changes unless the task explicitly allows them.

## Normal Flow

```sh
yoloop doctor --refresh-context
yoloop status
yoloop run --dry-run
yoloop decomposition write-verdict --verdict approved --summary "Task ledger is executable." --check "task-contract=passed:tasks have concrete criteria"
yoloop run --adapter codex-cli
```

## Artifact Map

- `GOAL.md`: immutable human-owned objective and success criteria.
- `PLAN.md`: master implementation plan.
- `TASKS.json`: machine task ledger.
- `DECOMPOSITION_REVIEW.md`: decomposition verdict and open task-plan gaps.
- `LOOP_POLICY.json`: budgets, gates, protected paths, and configured checks.
- `ADAPTERS.json`: local agent command templates.
- `raw/`: user-provided repo/product/domain context.
- `.yoloop/context-manifest.json`: manifest of `raw/`.
- `.yoloop/decomposition-verdicts/`: structured verdicts that gate worker execution.
- `.yoloop/events.jsonl`: machine event log.
- `.yoloop/human-log.jsonl`: canonical source for human logs.
- `PROGRESS.md`, `FAILURES.md`, `DECISIONS.md`: rendered human logs.
- `.yoloop/critic-verdicts/`: task verdicts.
- `.yoloop/grand-jury-verdicts/`: final verdicts.

## Verification

Use cheap validation by default:

```sh
yoloop doctor
```

Run actual discovered/configured checks only when the user asks for verification or before a critic verdict:

```sh
yoloop doctor --verify-checks
```
