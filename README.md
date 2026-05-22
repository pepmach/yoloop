# Yoloop

Yoloop is a local-first harness for long-running coding agents. It is designed for the "hands-off overnight feature" workflow: a human defines a durable goal, the harness decomposes work into tasks, fresh worker agents implement one task at a time, fresh critics verify the work, and a final jury checks the whole run before completion.

The current repo is a TypeScript-first MVP control plane. It is not published to npm yet and installability is still in progress. Today it creates Markdown runtime artifacts, validates JSON/JSONL state with Zod, runs a sequential worker-critic-grand-jury loop through host adapters, and protects core files through a `PreToolUse` hook command.

## Quick Start

The current MVP has a deterministic orchestrator, not a chat wizard. Pass the objective and task slices explicitly, then preview and run the adapter loop.

```powershell
npm run build
```

For local development, put the built CLI on `PATH`:

```powershell
npm install -g .
```

Print host-specific plugin setup instructions:

```powershell
yoloop install auto
```

Create the harness files:

```powershell
yoloop init --goal "Build the feature described by the product spec."
```

Add any long-form product notes, repo context, references, or investigation notes under `raw/`, then refresh the manifest:

```powershell
yoloop context refresh
```

Generate the goal, plan, prompts, policy, and task ledger:

```powershell
yoloop orchestrate `
  --objective "Build the feature described by the product spec." `
  --scope "Implement the feature in this repository." `
  --success "The feature is implemented and critic-approved." `
  --non-goal "Do not add parallel workers in this run." `
  --gate "Ask before dependency, migration, auth, or deploy changes." `
  --task "Plan the change and identify affected files." `
  --task "Implement the feature slice." `
  --task "Verify behavior and update harness logs." `
  --force
```

Validate harness state without running build/test/lint/typecheck:

```powershell
yoloop doctor --refresh-context
yoloop status
```

Optionally run the selected check plan. Yoloop merges user-configured checks from `LOOP_POLICY.json` with discovered checks, with user entries overriding discovered entries that share the same `kind:name`:

```powershell
yoloop doctor --verify-checks
```

Review the generated files before launching agents:

- `GOAL.md`
- `PLAN.md`
- `TASKS.json`
- `LOOP_POLICY.json`
- `ADAPTERS.json`

Preview the run. If the decomposition verdict is missing or stale, dry-run shows the decomposition critic command that will run before workers:

```powershell
yoloop run --dry-run
```

You can also approve or reject the decomposition manually:

```powershell
yoloop decomposition write-verdict `
  --verdict approved `
  --summary "Task ledger is executable." `
  --check "task-contract=passed:tasks have concrete criteria"
```

Make sure the selected adapter command exists on your machine. The default `claude-code` adapter expects `claude`; the default `codex-cli` adapter expects `codex`.

Run the sequential loop with the default Claude Code adapter template:

```powershell
yoloop run --adapter claude-code
```

Or test one adapter role directly:

```powershell
yoloop adapter run --adapter claude-code --role worker --dry-run
yoloop adapter run --adapter codex-cli --role critic --dry-run
```

## Command Reference

Normal commands are short. Role-specific diagnostics are nested under `adapter run`.

| Command | Purpose |
|---|---|
| `yoloop init` | Create the harness artifacts. |
| `yoloop install claude\|codex\|auto` | Validate packaged plugin surfaces and print host-specific setup instructions. |
| `yoloop context refresh` | Refresh `.yoloop/context-manifest.json` from `raw/`. |
| `yoloop doctor` | Run cheap validation only. |
| `yoloop doctor --refresh-context` | Run cheap validation and refresh the raw context manifest. |
| `yoloop doctor --verify-checks` | Execute the merged configured-plus-discovered check plan. |
| `yoloop status` | Print loop activity, goal hash status, grand jury status, raw context count, and task counts. |
| `yoloop orchestrate` | Write goal, plan, prompts, tasks, policy, and context references from explicit inputs. |
| `yoloop decomposition write-verdict` | Approve, reject, or escalate the generated task decomposition before workers can start. |
| `yoloop run` | Execute the sequential worker-critic-grand-jury loop. |
| `yoloop run --dry-run` | Preview the next loop action without launching agents or mutating task state. |
| `yoloop adapter run --role decomposition-critic\|worker\|critic\|grand-jury` | Test one adapter role directly. |
| `yoloop claim-next` | Manually claim the next task. Mostly useful for testing and manual harness operation. |
| `yoloop task set-status` | Manually transition a task status. `completed` requires an approved critic verdict. |
| `yoloop log append` | Append curated progress, failure, or decision entries. |
| `yoloop critic write-verdict` | Write the structured verdict that gates task completion. |
| `yoloop grand-jury write-verdict` | Write the structured final verdict that gates `<yoloop-done>`. |
| `yoloop pause` / `yoloop resume` | Pause or resume the loop policy. |
| `yoloop accept-goal` | Accept the current `GOAL.md` hash after an intentional goal edit. |
| `yoloop hook pretooluse` | Let host plugins ask Yoloop whether a proposed tool call should proceed. |

Deprecated compatibility forms are still accepted for now:

- `yoloop run --until-done`
- `yoloop run --execute`
- `yoloop run --role ...`

New usage should prefer `yoloop run`, `yoloop run --dry-run`, and `yoloop adapter run --role ...`.

## Runtime Artifacts

Human-facing artifacts are Markdown by default:

- `GOAL.md`: immutable human-owned objective, scope, success criteria, non-goals, and gates.
- `PLAN.md`: master implementation plan and task sequence.
- `WORKER_PROMPT.md`: worker session bootstrap.
- `CRITIC_PROMPT.md`: critic session bootstrap.
- `DECOMPOSITION_REVIEW.md`: rendered decomposition verdict and task-plan gaps.
- `PROGRESS.md`: rendered worker progress.
- `FAILURES.md`: rendered failure memory.
- `DECISIONS.md`: rendered decision log.
- `raw/`: user-owned context dump for specs, notes, references, and domain knowledge.

Machine-enforced artifacts stay structured:

- `TASKS.json`: task ledger.
- `LOOP_POLICY.json`: budgets, protected paths, human gates, and typed configured check commands.
- `ADAPTERS.json`: editable host adapter command templates.
- `.yoloop/goal.sha256`: accepted hash for immutable `GOAL.md`.
- `.yoloop/events.jsonl`: append-only machine event log.
- `.yoloop/human-log.jsonl`: canonical append-only source for progress, failure, and decision renders.
- `.yoloop/context-manifest.json`: sorted manifest of `raw/` files with path, byte size, SHA-256 hash, and media type.
- `.yoloop/decomposition-verdicts/`: structured decomposition verdicts that gate worker execution.
- `.yoloop/critic-verdicts/`: structured critic verdicts.
- `.yoloop/grand-jury-verdicts/`: structured final run verdicts.
- `.yoloop/runs/`: adapter stdout/stderr captures.

Optional HTML reports or dashboards can come later, but they are not the primary runtime state.

## Logging Protocol

Agents should not directly edit `PROGRESS.md`, `FAILURES.md`, or `DECISIONS.md`. They append curated entries through the CLI, and Yoloop renders the Markdown files from `.yoloop/human-log.jsonl`.

```powershell
yoloop log append --kind progress --task-id T-001 --actor worker-001 --summary "Started implementation" --body "Mapped the relevant modules and selected the task-local edit path."
yoloop log append --kind failure --task-id T-001 --actor worker-001 --summary "npm test failed" --body "The parser test exposed a missing edge case; next pass will add validation."
yoloop log append --kind decision --task-id T-001 --actor worker-001 --summary "Kept JSON as source of truth" --body "Structured artifacts remain the enforced state; human logs are rendered review material."
```

The expected worker cadence is:

- on task claim;
- after repo and `raw/` context survey;
- after each meaningful implementation unit;
- after every failed build, test, or critic cycle;
- before handoff to critic;
- before requesting human approval;
- before session exit.

## Doctor And Checks

`yoloop run` performs cheap preflight before launching agents. It validates required artifacts, parses JSON state, verifies the `GOAL.md` hash, refreshes `.yoloop/context-manifest.json`, discovers likely check commands by reading repo files, and validates configured check command strings.

Normal preflight does not run real build/test/lint/typecheck commands. Use the explicit check path when you want execution:

```powershell
yoloop doctor --verify-checks
```

Each check has a `kind`, `name`, `command`, `source`, and optional `packageManager`:

```json
{
  "kind": "test",
  "name": "test",
  "command": "npm test",
  "source": "user",
  "packageManager": "npm"
}
```

Supported check kinds are `build`, `lint`, `typecheck`, `test`, `integration`, and `check`.

Check selection is:

1. Start with `LOOP_POLICY.json.checks`.
2. Add discovered checks from files such as `package.json`, `Cargo.toml`, `pyproject.toml`, and `go.mod`.
3. If a configured check and discovered check share the same `kind:name`, use the configured check.

Discovery reads files only. It detects package managers such as `npm`, `pnpm`, `yarn`, `bun`, `cargo`, `python`, and `go`, but it does not spawn package managers during normal preflight.

## Task Decomposition Gate

`TASKS.json` includes milestone and task contracts. Each task records:

- `milestoneId`
- `successCriteria`
- `dependsOn`
- `allowedPaths`
- `risk`
- `checks`
- `gates`

Before workers launch, the current `GOAL.md`, `PLAN.md`, `LOOP_POLICY.json`, and `TASKS.json` must have an approved decomposition verdict under `.yoloop/decomposition-verdicts/`. If any of those artifacts change, the verdict becomes stale. `yoloop run` automatically launches the configured `decomposition-critic` adapter when the verdict is missing or stale, then proceeds only if the resulting verdict is approved.

## Host Plugins And Adapters

Yoloop is host-neutral. `ADAPTERS.json` contains command templates for agent hosts. The default catalog includes:

- `claude-code`
- `codex-cli`

The `plugins/yoloop` directory is intentionally thin and host-facing. It assumes the `yoloop` binary is on `PATH` and delegates runtime state to the TypeScript CLI.

Packaged host surfaces:

- Claude Code marketplace: `.claude-plugin/marketplace.json`
- Claude Code plugin: `plugins/yoloop/.claude-plugin/plugin.json`
- Codex marketplace: `.agents/plugins/marketplace.json`
- Codex plugin: `plugins/yoloop/.codex-plugin/plugin.json`
- Codex skill: `plugins/yoloop/skills/using-yoloop/SKILL.md`

After Yoloop is available on GitHub, Claude Code can install the marketplace with:

```powershell
claude plugin marketplace add pepmach/yoloop
claude plugin install yoloop@yoloop
```

Codex can load the bundled marketplace/plugin through its plugin marketplace flow. Run this to print the current instructions:

```powershell
yoloop install codex
```

The Claude Code hook delegates policy decisions to:

```powershell
yoloop hook pretooluse
```

The install command currently prints instructions and validates packaged artifacts; it does not mutate `~/.claude`, `~/.codex`, or user-level plugin marketplace files. Cursor and OpenCode are future integration targets.

## Goal Update Flow

`GOAL.md` is immutable while the loop is active. To change it:

```powershell
yoloop pause
# edit GOAL.md
yoloop accept-goal
yoloop resume
```

That mirrors the intended operating model: stop the loop, update the human-owned goal, accept the new hash, then relaunch.

## Architecture Bias

Yoloop keeps human review material in Markdown, enforcement state in JSON/JSONL, and host integrations as thin adapters over one TypeScript control plane.

Fresh one-shot role sessions are the default. Workers, critics, repair workers, decomposition critics, and grand juries should start from durable artifacts instead of relying on preserved chat transcripts. Startup speed should be improved through concise prompts, context manifests, discovered checks, and role-specific model policy rather than persistent sessions.

Parallel workers are intentionally deferred. They require worktree isolation, task ownership paths, merge policy, and integration critics.

## Development Notes

Run the normal checks before committing:

```powershell
npm run build
npm test
```

Primary source files:

- `src/main.ts`: CLI command dispatch.
- `src/app.ts`: init, status, doctor, preflight, pause/resume, goal acceptance.
- `src/orchestrator.ts`: deterministic orchestrator MVP.
- `src/runner.ts`: sequential worker-critic-grand-jury runner.
- `src/checks.ts`: check discovery and explicit check execution.
- `src/hooks.ts`: `PreToolUse` policy decisions.
- `src/logs.ts`: append-only human log entries and Markdown rendering.
- `src/tasks.ts`: task transitions and verdict-gated completion.
- `src/verdicts.ts` and `src/grandJury.ts`: structured verdict writers and gates.

See `docs/ROADMAP.md` and `docs/ARCHITECTURE.md` for the next product slices.
