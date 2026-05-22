---
description: Write the Yoloop decomposition verdict
argument-hint: "--verdict approved|rejected|human-approval-required --summary TEXT --check name=status:evidence [--gap TEXT]"
allowed-tools: Bash(yoloop:*)
---

Write the Yoloop decomposition verdict after reviewing whether the task ledger is executable.

Use Bash to run:

```sh
yoloop decomposition write-verdict $ARGUMENTS
```

Require `--verdict approved`, `--verdict rejected`, or `--verdict human-approval-required`, plus a concise `--summary` and at least one `--check name=status:evidence`. Use `--gap` for unresolved decomposition issues. Workers must not start until the latest decomposition verdict is approved and current for `GOAL.md`, `PLAN.md`, `LOOP_POLICY.json`, and `TASKS.json`.
