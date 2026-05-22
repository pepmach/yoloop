---
description: Refresh the Yoloop raw context manifest
argument-hint: ""
allowed-tools: Bash(yoloop:*)
---

Refresh the Yoloop raw context manifest.

Use Bash to run:

```sh
yoloop context refresh --actor human
```

Run this after adding or editing files under `raw/` so agents can inspect `.yoloop/context-manifest.json` before planning, implementing, or reviewing work.
