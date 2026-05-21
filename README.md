# Yoloop

Yoloop is a local-first harness for long-running coding agents. It is designed for the "hands-off overnight feature" workflow: a human defines an immutable goal, the harness decomposes work into tasks, workers implement one task at a time, critics verify the work, and a final jury checks the whole run before completion.

This repo is currently a TypeScript-first MVP control plane. It creates durable state, validates machine artifacts with Zod, enforces policy through hooks, and gives agent sessions a shared artifact protocol.

## Development

```powershell
npm install
npm run build
npm test
node dist/cli.js doctor
```

The npm package exposes a `yoloop` binary from `dist/cli.js`.

## Quick Start

```powershell
yoloop init --goal "Build the feature described by the product spec."
yoloop doctor
yoloop status
yoloop orchestrate --objective "Build the feature described by the product spec." --task "Plan the change" --task "Implement the change" --force
yoloop claim-next --worker worker-001
yoloop task set-status --id T-001 --status critic_review --actor worker-001
yoloop log append --kind progress --task-id T-001 --actor worker-001 --summary "Finished implementation pass" --body "Changed the parser and ran npm test."
yoloop critic write-verdict --task-id T-001 --verdict approved --summary "Verified" --check "npm test=passed:clean"
yoloop task set-status --id T-001 --status completed --actor critic
yoloop run --dry-run
yoloop run
yoloop adapter run --adapter claude-code --role worker --dry-run
```

The generated harness files are:

- `GOAL.html`: immutable human-owned goal and success criteria.
- `LOOP_POLICY.json`: budgets, protected paths, and human approval gates.
- `ADAPTERS.json`: editable host adapter command templates.
- `PLAN.html`: master implementation plan.
- `TASKS.json`: structured task ledger.
- `WORKER_PROMPT.html`: worker session bootstrap.
- `CRITIC_PROMPT.html`: critic session bootstrap.
- `PROGRESS.html`: append-only human-readable worker progress.
- `FAILURES.html`: append-only human-readable failure memory.
- `DECISIONS.html`: append-only human-readable decision log.
- `raw/`: user-supplied product notes, repo context, references, and domain knowledge for the orchestrator, worker, critic, and grand jury.
- `.yoloop/events.jsonl`: append-only machine event log.
- `.yoloop/critic-verdicts/`: structured critic verdict output.

## Design Bias

The harness keeps human-readable logs for review, but uses JSON/JSONL for enforcement. Agents can write prose for humans; the harness enforces immutable goals, budgets, task ownership, and policy decisions from structured files.

### Artifact Format Policy

Yoloop uses different file formats for different jobs:

- HTML for generated human review surfaces: runtime goals, plans, prompts, progress logs, failure memory, decision logs, and future critic or grand-jury reports.
- Markdown for source-controlled OSS collaboration docs: README, contributor docs, install docs, public roadmap, and host instruction files.
- JSON/JSONL for enforcement and machine state: tasks, policy, adapters, verdicts, hashes, and events.

Workers append curated human log entries through `yoloop log append` instead of directly editing the HTML files:

```powershell
yoloop log append --kind progress --task-id T-001 --actor worker-001 --summary "Started implementation" --body "Mapped the relevant modules and selected the task-local edit path."
yoloop log append --kind failure --task-id T-001 --actor worker-001 --summary "npm test failed" --body "The parser test exposed a missing edge case; next pass will add validation."
yoloop log append --kind decision --task-id T-001 --actor worker-001 --summary "Kept JSON as source of truth" --body "HTML remains human review material; TASKS.json remains the enforced task ledger."
```

While the loop is active, hooks block direct `Write`/`Edit`/`MultiEdit` changes to `PROGRESS.html`, `FAILURES.html`, and `DECISIONS.html`. This keeps the files human-readable without turning them into raw stdout dumps or agent scratchpads.

`raw/` is intentionally outside the generated prompt files. Drop long-form specs, notes, architectural background, screenshots exported as text, previous investigation notes, or other context there. The generated prompts tell agents to inspect it before planning or editing so the loop is not limited to the initial chat transcript.

The TypeScript source is strict and Zod-first. Runtime schemas in `src/schemas.ts` are the source of truth for JSON artifacts; generated JSON Schema files can be added later if external tooling needs them.

`yoloop orchestrate` is the deterministic Orchestrator MVP. It reads `raw/`, accepts explicit objective/scope/success/non-goal/gate/task inputs, and writes the durable harness artifacts without launching workers.

Task completion is gated by critic verdicts. `yoloop task set-status --status completed` fails unless the latest verdict for that task is `approved`.

```powershell
yoloop critic write-verdict --task-id T-001 --verdict approved --summary "Verified" --check "npm test=passed:clean"
yoloop task set-status --id T-001 --status completed --actor critic
```

## Host Adapters

Yoloop is meant to stay host-neutral. The `plugins/yoloop` directory is the first adapter: a thin Claude Code plugin wrapper that assumes the `yoloop` binary is installed on `PATH` and delegates hook decisions to:

```powershell
yoloop hook pretooluse
```

Future adapters for Codex, OpenCode, Cursor, and other agent runtimes should share the same state machine instead of forking the harness logic.

`yoloop run` executes the sequential worker-critic loop by default. Use `--dry-run` to preview the first claimable task and rendered worker/critic adapter commands without launching agents or changing task state:

```powershell
yoloop run --dry-run
yoloop run --adapter claude-code
```

Role-specific adapter testing lives under `yoloop adapter run`. It executes the selected role by default and supports `--dry-run` for command preview:

```powershell
yoloop adapter run --adapter claude-code --role worker --dry-run
yoloop adapter run --adapter codex-cli --role critic
```

Adapter templates live in `ADAPTERS.json` so Claude Code, Codex, and future hosts can evolve independently of the harness state machine.

`yoloop run --until-done`, `yoloop run --execute`, and `yoloop run --role ...` are accepted as deprecated compatibility forms for now. New usage should prefer `yoloop run`, `yoloop run --dry-run`, and `yoloop adapter run --role ...`.

## Goal Update Flow

`GOAL.html` is immutable while the loop is active. To change it:

```powershell
yoloop pause
# edit GOAL.html
yoloop accept-goal
yoloop resume
```

That mirrors the intended operational model: stop the loop, update the human-owned goal, accept the new hash, then relaunch.
