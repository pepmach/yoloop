# Yoloop Host Plugin

This plugin is intentionally thin. It delegates policy checks and project state to the `yoloop` CLI.

Install or load this plugin only after the `yoloop` binary is available on `PATH`.

Packaged host surfaces:

- Claude Code: `.claude-plugin/plugin.json`, `commands/`, and `hooks/hooks.json`.
- Codex: `.codex-plugin/plugin.json` and `skills/using-yoloop/SKILL.md`.

Run `yoloop install auto` from the npm package or source checkout to print host-specific setup instructions.

Claude Code commands:

- `/yoloop:init`
- `/yoloop:status`
- `/yoloop:doctor`
- `/yoloop:context-refresh`
- `/yoloop:pause`
- `/yoloop:accept-goal`
- `/yoloop:resume`
- `/yoloop:run`
- `/yoloop:adapter-run`
- `/yoloop:log-append`
- `/yoloop:decomposition-write-verdict`
- `/yoloop:grand-jury-write-verdict`
- `/yoloop:run-until-done`

`/yoloop:run-until-done` is deprecated and kept only as a compatibility command. Prefer `/yoloop:run`.

Hooks:

- `PreToolUse` calls `yoloop hook pretooluse` to enforce `LOOP_POLICY.json`.

Codex skill:

- `using-yoloop` teaches Codex to run `yoloop doctor`, refresh `raw/` context, preview with `yoloop run --dry-run`, append curated human logs, and avoid direct edits to protected Yoloop artifacts.
