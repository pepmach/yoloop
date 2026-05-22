# Yoloop Architecture

Yoloop starts with a conservative sequential loop:

1. Orchestrator turns the human goal, `raw/` context, check instructions, and constraints into a durable plan.
2. Decomposition critic blocks worker execution until the task ledger is executable.
3. Fresh one-shot worker claims one approved task and implements it.
4. Fresh one-shot critic verifies deterministic checks, code quality, and task fit.
5. Fresh one-shot repair worker handles rejected tasks with failure memory and critic context.
6. Fresh one-shot grand jury verifies the whole run and only then allows the harness to emit `<yoloop-done>`.
7. Report synthesis writes a Markdown summary before done, human review, failure, timeout, or budget exhaustion.

Parallel workers are a later feature. They require worktree isolation, ownership-aware tasks, merge strategy, and conflict-safe critic review.

## Orchestrator

`yoloop orchestrate` is currently deterministic and local. It reads `raw/`, accepts explicit objective, scope, success, non-goal, gate, and task inputs, then writes the durable harness artifacts without launching workers.

The intended next shape is a guided interactive CLI wizard. It should ask for objective, scope, success criteria, non-goals, human gates, milestone strategy, and build/test/check instructions while preserving non-interactive flags for agents and automation.

## Decomposition Critic

The decomposition critic is a blocking stage between orchestrator and worker. It exists to prevent expensive overnight runs from starting with vague or unexecutable tasks.

It should verify:

- every task has concrete success criteria;
- every task maps to a milestone;
- every task has expected checks or an explicit no-check reason;
- known write scopes include allowed or expected paths;
- dependencies are valid and acyclic;
- tasks are small enough for one worker session;
- tasks do not mix unrelated milestones;
- risky work has human approval gates;
- the task plan respects non-goals, raw context, and policy.

The current CLI supports this gate with `yoloop decomposition write-verdict`. It writes a structured verdict under `.yoloop/decomposition-verdicts/` and renders `DECOMPOSITION_REVIEW.md`. `yoloop run` automatically launches the configured `decomposition-critic` adapter when the latest verdict is missing or stale, then refuses to start workers unless the resulting verdict is approved for the current goal, plan, policy, and task ledger hashes.

The remaining work is stronger static checks for task size, dependency validity, ownership paths, and non-goal violations.

## State Model

The current implementation emits Markdown-primary human artifacts backed by JSON/JSONL state.

Human-readable Markdown files:

- `GOAL.md`
- `PLAN.md`
- `WORKER_PROMPT.md`
- `CRITIC_PROMPT.md`
- `DECOMPOSITION_REVIEW.md`
- `PROGRESS.md`
- `FAILURES.md`
- `DECISIONS.md`
- `REPORT.md`

User context:

- `raw/`: user-owned context dump for product notes, repo knowledge, references, and domain material.

Machine-enforced files:

- `LOOP_POLICY.json`
- `TASKS.json`
- `ADAPTERS.json`
- `.yoloop/goal.sha256`
- `.yoloop/events.jsonl`
- `.yoloop/human-log.jsonl`
- `.yoloop/context-manifest.json`
- `.yoloop/decomposition-verdicts/*.json`
- `.yoloop/critic-verdicts/*.json`
- `.yoloop/grand-jury-verdicts/*.json`
- `.yoloop/decision-queue.json`
- `.yoloop/reports/*.md`

Optional HTML belongs later as generated reports or dashboards, not as primary runtime state.

## Doctor And Context Preflight

`yoloop run` performs a cheap doctor-style preflight before launching agents. It validates required artifacts, parses JSON state, verifies the `GOAL.md` hash, refreshes `.yoloop/context-manifest.json`, discovers likely check commands by reading repo files, and validates configured check command strings.

Normal preflight must stay cheap. It must not run real checks such as build, test, lint, or typecheck. Those belong to critic execution or the explicit `yoloop doctor --verify-checks` path.

Checks are typed by `kind`: `build`, `lint`, `typecheck`, `test`, `integration`, or `check`. Discovery attaches package/tool metadata such as `npm`, `pnpm`, `yarn`, `bun`, `cargo`, `python`, or `go`.

User-specified check instructions live in `LOOP_POLICY.json.checks` and are merged with discovery. `yoloop doctor --verify-checks` runs the merged selected check plan; configured checks override discovered checks with the same `kind:name`, while unrelated discovered checks still run. Preflight does not silently rewrite policy during `run`; detected checks should be accepted through the wizard or an explicit command.

`raw/` is indexed into `.yoloop/context-manifest.json` by `yoloop context refresh`, `yoloop init`, `yoloop orchestrate`, and non-dry-run `yoloop run`. The manifest includes paths, byte sizes, SHA-256 hashes, and media types. Summaries can come later.

## Host Adapters

`ADAPTERS.json` defines editable command templates for each agent host. `yoloop run` executes the sequential worker-critic-grand-jury loop by default, while `yoloop run --dry-run` previews rendered commands. Role-specific diagnostics live under `yoloop adapter run --role ...`.

The default catalog includes `claude-code` and `codex-cli`. These are adapter templates, not separate implementations. The TypeScript core owns task state, policy state, event logging, and artifact paths.

Installability has a packaged baseline:

- `.claude-plugin/marketplace.json` exposes the repo as a Claude Code marketplace.
- `plugins/yoloop/.claude-plugin/plugin.json` exposes Claude Code slash commands and hooks.
- `.agents/plugins/marketplace.json` exposes the repo as a Codex marketplace.
- `plugins/yoloop/.codex-plugin/plugin.json` exposes the Codex plugin bundle.
- `plugins/yoloop/skills/using-yoloop/SKILL.md` gives Codex reusable Yoloop operating rules.
- `yoloop install claude|codex|auto` validates the packaged surfaces and prints setup instructions without mutating host config.

Remaining installability work is npm publication prep, host-specific install/link verification, optional user-level marketplace mutation behind explicit approval, and better doctor checks. Cursor and OpenCode are future integration targets.

## Verdicts

Critics write structured verdicts with `yoloop critic write-verdict`. Yoloop writes both a timestamped verdict and a latest verdict pointer under `.yoloop/critic-verdicts/`.

A task cannot transition to `completed` unless its latest critic verdict is `approved`. Rejected and human-approval-required verdicts keep the task out of the completed state.

After all runnable tasks are completed, `yoloop run` launches the configured `grand-jury` adapter. The grand jury writes a structured final verdict with `yoloop grand-jury write-verdict`. The harness emits `<yoloop-done>` only when the latest grand jury verdict is `approved`.

## Decision Queue

Human gates should be structured as a Codex-style decision queue, not vague stop messages. Each decision should include task ID, milestone ID, question, generated options, recommended option, freeform input, affected files, risk, escalation reason, and status.

The canonical state should live in `.yoloop/decision-queue.json`, with a Markdown render included in `REPORT.md` and any human review surface.

## Sequential Runner

`yoloop run` runs the conservative sequential loop. Before launching workers, it runs cheap preflight, launches a fresh decomposition critic if needed, and requires an approved, current decomposition verdict. It then launches one fresh worker adapter for the next claimable task, requires the worker to hand off through `critic_review`, launches one fresh critic adapter, then completes the task only after an approved critic verdict.

Rejected verdicts should launch a fresh repair worker with the task, critic verdict, failure memory, decision log, and diff context. Retry budgets should eventually account for repeated failure signatures, not just raw attempt count.

When all runnable tasks are completed, the runner launches the grand jury adapter and requires an approved final verdict before emitting `<yoloop-done>`.

## Milestones, Commits, And PR Body

Tasks should roll up into milestones. A completed milestone can warrant a local commit and PR body section. The default should not auto-push or open a PR; publishing remains an explicit user action.

## Policy Enforcement

The CLI exposes `yoloop hook pretooluse` so host runtimes can ask the harness whether a proposed tool call should proceed. The first adapter targets Claude Code because it has a `PreToolUse` hook surface, but the policy engine is not Claude-specific.

The first policy checks are deliberately simple:

- deny edits to the goal file;
- deny edits to `.yoloop/goal.sha256`;
- deny edits to `LOOP_POLICY.json` while the loop is active;
- deny direct edits to append-only human logs;
- deny risky shell command substrings;
- deny mutating tools if the goal hash changed while active.

Future policy compilation should include task ownership, dependency changes, migrations, secret paths, generated test commands, model policy, and human approval state.

## Why TypeScript Core

Yoloop optimizes for npm distribution, plugin adapters, MCP-style integrations, dashboards, JSON tooling, and OSS contributor attraction. TypeScript is the best fit for that product surface.

The implementation should still behave like a systems tool: strict TypeScript, Zod-first runtime validation, atomic writes for state files, append-only JSONL events, and supervised child processes.

## Session Model

Fresh one-shot role sessions are the default architecture. Each worker, critic, repair worker, decomposition critic, and grand jury must be able to start from durable artifacts, events, logs, context manifest, task ledger, policy, and verdicts without depending on prior chat history.

Persistent sessions are excluded from the default loop. They may be explored later only as an opt-in performance experiment with explicit stale-context detection, transcript capture, cancellation behavior, and policy supervision. They should never become a correctness dependency.
