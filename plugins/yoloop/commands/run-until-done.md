---
description: Deprecated compatibility command for old Yoloop run UX
argument-hint: "[--adapter NAME] [--dry-run]"
allowed-tools: Bash(yoloop:*)
---

Deprecated compatibility command for the old Yoloop sequential loop UX.

Use Bash to run:

```sh
yoloop run --until-done $ARGUMENTS
```

Tell the user this command is deprecated. The preferred command is `/yoloop:run`, which delegates to `yoloop run`.
