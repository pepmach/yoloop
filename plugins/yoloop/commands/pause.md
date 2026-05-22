---
description: Pause Yoloop policy enforcement
argument-hint: ""
allowed-tools: Bash(yoloop:*)
---

Pause Yoloop policy enforcement so the human can edit goal or policy files.

Use Bash to run:

```sh
yoloop pause --actor human
```

Tell the user to resume with `/yoloop:resume` after accepting any goal update.
