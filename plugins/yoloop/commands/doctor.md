Check the Yoloop harness invariants.

Use Bash to run:

```sh
yoloop doctor
```

Report missing files, parse failures, or goal hash mismatch.

Normal doctor checks are cheap and do not run build/test/lint/typecheck commands. Use `yoloop doctor --verify-checks` to run configured checks, or discovered checks when none are configured. Use `yoloop doctor --refresh-context` if the raw context manifest should be refreshed during doctor.
