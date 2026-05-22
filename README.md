# Yoloop

Yoloop is a local-first harness for long-running coding agents. It is designed for the "hands-off overnight feature" workflow: a human defines an immutable goal, the harness decomposes work into tasks, workers implement one task at a time, critics verify the work, and a final jury checks the whole run before completion.

This repo is currently a TypeScript-first MVP control plane. It creates durable Markdown artifacts, validates machine artifacts with Zod, enforces policy through hooks, and gives agent sessions a shared artifact protocol.

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
yoloop context refresh
yoloop doctor
yoloop status
yoloop orchestrate --objective "Build the feature described by the product spec." --task "Plan the change" --task "Implement the change" --force
yoloop claim-next --worker worker-001
yoloop task set-status --id T-001 --status critic_review --actor worker-001
yoloop log append --kind progress --task-id T-001 --actor worker-001 --summary "Finished implementation pass" --body "Changed the parser and ran npm test."
yoloop critic write-verdict --task-id T-001 --verdict approved --summary "Verified" --check "npm test=passed:clean"
yoloop task set-status --id T-001 --status completed --actor critic
yoloop grand-jury write-verdict --verdict approved --summary "Final run verified" --check "final=passed:all tasks and logs reviewed"
yoloop run --dry-run
yoloop run
yoloop adapter run --adapter claude-code --role worker --dry-run
```

The generated harness files are:

- `GOAL.md`: immutable human-owned goal and success criteria.
- `LOOP_POLICY.json`: budgets, protected paths, human approval gates, and configured check commands.
- `ADAPTERS.json`: editable host adapter command templates.
- `PLAN.md`: master implementation plan.
- `TASKS.json`: structured task ledger.
- `WORKER_PROMPT.md`: worker session bootstrap.
- `CRITIC_PROMPT.md`: critic session bootstrap.
- `PROGRESS.md`: rendered worker progress.
- `FAILURES.md`: rendered failure memory.
- `DECISIONS.md`: rendered decision log.
- `raw/`: user-supplied product notes, repo context, references, and domain knowledge for the orchestrator, worker, critic, and grand jury.
- `.yoloop/events.jsonl`: append-only machine event log.
- `.yoloop/human-log.jsonl`: canonical append-only human log state rendered into progress, failure, and decision Markdown files.
- `.yoloop/context-manifest.json`: sorted manifest of `raw/` files with path, byte size, SHA-256 hash, and media type.
- `.yoloop/critic-verdicts/`: structured critic verdict output.
- `.yoloop/grand-jury-verdicts/`: structured final run verdict output.

## Design Bias

The harness keeps human-readable logs for review, but uses JSON/JSONL for enforcement. Agents can write prose for humans; the harness enforces immutable goals, budgets, task ownership, and policy decisions from structured files.

Yoloop's default execution model is fresh one-shot role sessions. Workers, critics, repair workers, decomposition critics, and grand juries should start from durable artifacts instead of relying on a preserved chat transcript. Startup speed should be improved through concise prompts, context manifests, discovered checks, and role-specific model policy rather than persistent sessions.

### Artifact Format Policy

Yoloop uses different file formats for different jobs:

- Markdown for default human review surfaces: runtime goals, plans, prompts, decomposition review, progress logs, failure memory, decision logs, run reports, README, contributor docs, public roadmap, and host instruction files.
- JSON/JSONL for enforcement and machine state: tasks, policy, adapters, verdicts, hashes, events, raw context manifests, decision queues, and canonical human log entries.
- HTML only for optional rich generated reports or dashboards later.

The current runtime artifact set is `GOAL.md`, `PLAN.md`, `WORKER_PROMPT.md`, `CRITIC_PROMPT.md`, `PROGRESS.md`, `FAILURES.md`, and `DECISIONS.md`, backed by `.yoloop/human-log.jsonl` and `.yoloop/context-manifest.json`. Future slices add `DECOMPOSITION_REVIEW.md`, `REPORT.md`, `.yoloop/decomposition-verdicts/`, and `.yoloop/decision-queue.json`.

Workers append curated human log entries through `yoloop log append` instead of directly editing the rendered Markdown files:

```powershell
yoloop log append --kind progress --task-id T-001 --actor worker-001 --summary "Started implementation" --body "Mapped the relevant modules and selected the task-local edit path."
yoloop log append --kind failure --task-id T-001 --actor worker-001 --summary "npm test failed" --body "The parser test exposed a missing edge case; next pass will add validation."
yoloop log append --kind decision --task-id T-001 --actor worker-001 --summary "Kept JSON as source of truth" --body "Structured artifacts remain the enforced state; human logs are rendered review material."
```

While the loop is active, hooks block direct `Write`/`Edit`/`MultiEdit` changes to the append-only human logs and their canonical JSONL source. This keeps the files human-readable without turning them into raw stdout dumps or agent scratchpads.

`raw/` is intentionally outside the generated prompt files. Drop long-form specs, notes, architectural background, screenshots exported as text, previous investigation notes, or other context there. `yoloop context refresh` writes `.yoloop/context-manifest.json` so fresh agent sessions can inspect available context without rediscovering the raw tree from scratch.

The TypeScript source is strict and Zod-first. Runtime schemas in `src/schemas.ts` are the source of truth for JSON artifacts; generated JSON Schema files can be added later if external tooling needs them.

### Doctor Preflight

`yoloop run` performs a cheap preflight before launching agents. This preflight validates required artifacts, parses JSON state, verifies the `GOAL.md` hash, refreshes `.yoloop/context-manifest.json`, discovers likely check commands by reading repo files, and validates configured check command strings.

Normal preflight does not run real checks such as `npm test`, `npm run build`, lint, or typecheck. Those belong to critic execution or an explicit verification pass:

```powershell
yoloop doctor --verify-checks
```

`yoloop doctor --verify-checks` runs configured `LOOP_POLICY.json` checks when present; otherwise it runs discovered checks. Plain `yoloop doctor` reports configured and discovered check counts without executing them. Use `yoloop doctor --refresh-context` when you want doctor to refresh the raw context manifest too.

`yoloop orchestrate` is the deterministic Orchestrator MVP. It reads `raw/`, accepts explicit objective/scope/success/non-goal/gate/task inputs, and writes the durable harness artifacts without launching workers.

The next orchestration shape adds a blocking decomposition critic between orchestration and workers. It should reject vague tasks, missing success criteria, invalid dependencies, missing checks, unsafe scopes, missing milestone ownership, and plans that violate non-goals or human gates. `yoloop run` should refuse to launch workers unless the latest decomposition verdict is approved for the current goal, plan, policy, and task ledger hashes.

Task completion is gated by critic verdicts. `yoloop task set-status --status completed` fails unless the latest verdict for that task is `approved`.

```powershell
yoloop critic write-verdict --task-id T-001 --verdict approved --summary "Verified" --check "npm test=passed:clean"
yoloop task set-status --id T-001 --status completed --actor critic
```

Loop completion is gated by the grand jury. After all runnable tasks are completed, `yoloop run` launches the `grand-jury` adapter and emits `<yoloop-done>` only after the latest final verdict is approved:

```powershell
yoloop grand-jury write-verdict --verdict approved --summary "Final run verified" --check "final=passed:all tasks, verdicts, failures, decisions, and non-goals reviewed"
```

## Host Adapters

Yoloop is meant to stay host-neutral. The `plugins/yoloop` directory is the first adapter: a thin Claude Code plugin wrapper that assumes the `yoloop` binary is installed on `PATH` and delegates hook decisions to:

```powershell
yoloop hook pretooluse
```

Future adapters for Codex, OpenCode, Cursor, and other agent runtimes should share the same state machine instead of forking the harness logic.

Installability is not solved yet. The project should add `yoloop install claude|codex|auto`, npm publication prep, and clear verification so users are not left guessing how to connect an installed npm package to Claude Code or Codex. If the `yoloop` npm name is unavailable, the release plan should use a scoped fallback such as `@pepmach/yoloop`.

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

`GOAL.md` is immutable while the current loop is active. To change the current goal:

```powershell
yoloop pause
# edit GOAL.md
yoloop accept-goal
yoloop resume
```

That mirrors the intended operational model: stop the loop, update the human-owned goal, accept the new hash, then relaunch.
