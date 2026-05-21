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
- `/yoloop:run`
- `/yoloop:adapter-run`
- `/yoloop:log-append`
- `/yoloop:run-until-done`

`/yoloop:run-until-done` is deprecated and kept only as a compatibility command. Prefer `/yoloop:run`.

Hooks:

- `PreToolUse` calls `yoloop hook pretooluse` to enforce `LOOP_POLICY.json`.
