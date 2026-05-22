Append a curated human-readable entry to a Yoloop log file.

Use Bash to run:

```sh
yoloop log append $ARGUMENTS
```

Require `--kind progress`, `--kind failure`, or `--kind decision`, plus a concise `--summary`. Prefer `--task-id`, `--actor`, and `--body` when available. Do not write directly to `PROGRESS.md`, `FAILURES.md`, `DECISIONS.md`, or `.yoloop/human-log.jsonl`.
