# Yoloop Claude Code Plugin

This plugin is intentionally thin. It delegates policy checks and project state to the `yoloop` CLI.

Install or load this plugin only after the `yoloop` binary is available on `PATH`.

Commands:

- `/yoloop:init`
- `/yoloop:status`
- `/yoloop:doctor`
- `/yoloop:pause`
- `/yoloop:accept-goal`
- `/yoloop:resume`
- `/yoloop:run-until-done`

Hooks:

- `PreToolUse` calls `yoloop hook pretooluse` to enforce `LOOP_POLICY.json`.
