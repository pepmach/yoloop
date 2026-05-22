---
description: Run or preview one Yoloop adapter role
argument-hint: "--role decomposition-critic|worker|critic|grand-jury [--adapter NAME] [--dry-run]"
allowed-tools: Bash(yoloop:*)
---

Run or preview one configured Yoloop adapter role in the current project.

Use Bash to run:

```sh
yoloop adapter run $ARGUMENTS
```

Require the user to include `--role decomposition-critic`, `--role worker`, `--role critic`, or `--role grand-jury`. Use `--dry-run` when the user wants to preview the rendered command without launching the adapter.
