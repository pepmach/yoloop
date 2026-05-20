# Yoloop

Yoloop is a local-first harness for long-running coding agents. It is designed for the "hands-off overnight feature" workflow: a human defines an immutable goal, the harness decomposes work into tasks, workers implement one task at a time, critics verify the work, and a final jury checks the whole run before completion.

This repo is currently an MVP control plane. It does not yet launch agent CLIs by itself. It creates durable state, enforces policy through hooks, and gives agent sessions a shared artifact protocol.

## Quick Start

```powershell
yoloop init --goal "Build the feature described by the product spec."
yoloop doctor
yoloop status
yoloop claim-next --worker worker-001
yoloop task set-status --id T-001 --status critic_review --actor worker-001
```

The generated harness files are:

- `GOAL.html`: immutable human-owned goal and success criteria.
- `LOOP_POLICY.json`: budgets, protected paths, and human approval gates.
- `PLAN.html`: master implementation plan.
- `TASKS.json`: structured task ledger.
- `WORKER_PROMPT.html`: worker session bootstrap.
- `CRITIC_PROMPT.html`: critic session bootstrap.
- `PROGRESS.html`: human-readable worker progress.
- `FAILURES.html`: human-readable failure memory.
- `DECISIONS.html`: human-readable decision log.
- `.yoloop/events.jsonl`: append-only machine event log.
- `.yoloop/critic-verdicts/`: structured critic verdict output.

## Design Bias

The harness keeps human-readable logs for review, but uses JSON/JSONL for enforcement. Agents can write prose for humans; the harness enforces immutable goals, budgets, task ownership, and policy decisions from structured files.

## Host Adapters

Yoloop is meant to stay host-neutral. The `plugins/yoloop` directory is the first adapter: a thin Claude Code plugin wrapper that assumes the `yoloop` binary is installed on `PATH` and delegates hook decisions to:

```powershell
yoloop hook pretooluse
```

Future adapters for Codex, OpenCode, Cursor, and other agent runtimes should share the same state machine instead of forking the harness logic.

## Goal Update Flow

`GOAL.html` is immutable while the loop is active. To change it:

```powershell
yoloop pause
# edit GOAL.html
yoloop accept-goal
yoloop resume
```

That mirrors the intended operational model: stop the loop, update the human-owned goal, accept the new hash, then relaunch.
