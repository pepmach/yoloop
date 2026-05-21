Write the final Yoloop grand jury verdict after all runnable tasks are completed.

Use Bash to run:

```sh
yoloop grand-jury write-verdict $ARGUMENTS
```

Require `--verdict approved`, `--verdict rejected`, or `--verdict human-approval-required`, plus a concise `--summary` and at least one `--check name=status:evidence`. Use `--gap` for unresolved issues. The harness emits `<yoloop-done>` only after an approved grand jury verdict.
