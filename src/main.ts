import { readFileSync } from "fs";
import { init, doctor, status, setActive, acceptGoal } from "./app";
import { runAdapter } from "./adapters";
import { refreshContextManifest } from "./context";
import { fail } from "./errors";
import { writeGrandJuryVerdict } from "./grandJury";
import { printHookDecision, pretooluse } from "./hooks";
import { goalIntegrity } from "./io";
import { appendHumanLog, parseHumanLogKind } from "./logs";
import { orchestrate } from "./orchestrator";
import { runUntilDone } from "./runner";
import { AgentRoleSchema } from "./schemas";
import { claimNext, setTaskStatus } from "./tasks";
import { parseVerdictDecision, writeCriticVerdict } from "./verdicts";

export function run(args: string[], root: string): void {
  const [command, subcommand, ...rest] = args;

  switch (command) {
    case "init": {
      const options = parseOptions([subcommand, ...rest].filter(Boolean));
      init(root, options.one("goal"), options.flag("force"));
      return;
    }
    case "status":
      status(root);
      return;
    case "doctor": {
      const options = parseOptions([subcommand, ...rest].filter(Boolean));
      doctor(root, { refreshContext: options.flag("refresh-context") });
      return;
    }
    case "pause": {
      const options = parseOptions([subcommand, ...rest].filter(Boolean));
      setActive(root, false, options.one("actor") ?? "human");
      return;
    }
    case "resume": {
      const options = parseOptions([subcommand, ...rest].filter(Boolean));
      goalIntegrity(root);
      setActive(root, true, options.one("actor") ?? "human");
      return;
    }
    case "accept-goal": {
      const options = parseOptions([subcommand, ...rest].filter(Boolean));
      acceptGoal(root, options.one("actor") ?? "human");
      return;
    }
    case "claim-next": {
      const options = parseOptions([subcommand, ...rest].filter(Boolean));
      claimNext(root, options.one("worker") ?? "worker-local");
      return;
    }
    case "orchestrate": {
      const options = parseOptions([subcommand, ...rest].filter(Boolean));
      orchestrate(root, {
        objective: options.required("objective"),
        scope: options.many("scope"),
        success: options.many("success"),
        nonGoal: options.many("non-goal"),
        gate: options.many("gate"),
        task: options.many("task"),
        force: options.flag("force"),
      });
      return;
    }
    case "context":
      if (subcommand !== "refresh") {
        fail("expected context refresh");
      }
      runContextRefresh(root, rest);
      return;
    case "run": {
      const options = parseOptions([subcommand, ...rest].filter(Boolean));
      const adapter = options.one("adapter") ?? "claude-code";
      warnDeprecatedFlag(options, "until-done", "yoloop run now runs the sequential loop by default");
      warnDeprecatedFlag(options, "execute", "yoloop run now executes by default");
      const roleValue = options.one("role");
      if (roleValue) {
        warn("yoloop run --role is deprecated; use yoloop adapter run --role instead");
        const role = AgentRoleSchema.parse(roleValue);
        runAdapter(root, adapter, role, options.flag("dry-run"));
        return;
      }
      runUntilDone(root, { adapter, dryRun: options.flag("dry-run") });
      return;
    }
    case "adapter": {
      if (subcommand !== "run") {
        fail("expected adapter run");
      }
      runAdapterCommand(root, rest);
      return;
    }
    case "task":
      if (subcommand !== "set-status") {
        fail("expected task set-status");
      }
      runTaskSetStatus(root, rest);
      return;
    case "critic":
      if (subcommand !== "write-verdict") {
        fail("expected critic write-verdict");
      }
      runCriticWriteVerdict(root, rest);
      return;
    case "grand-jury":
      if (subcommand !== "write-verdict") {
        fail("expected grand-jury write-verdict");
      }
      runGrandJuryWriteVerdict(root, rest);
      return;
    case "log":
      if (subcommand !== "append") {
        fail("expected log append");
      }
      runLogAppend(root, rest);
      return;
    case "hook":
      if (subcommand !== "pretooluse") {
        fail("expected hook pretooluse");
      }
      printHookDecision(pretooluse(root, readStdin()));
      return;
    default:
      fail(`unknown command ${command ?? ""}`.trim());
  }
}

function runContextRefresh(root: string, args: string[]): void {
  const options = parseOptions(args);
  refreshContextManifest(root, options.one("actor") ?? "human");
}

function runTaskSetStatus(root: string, args: string[]): void {
  const options = parseOptions(args);
  const id = options.required("id");
  const nextStatus = options.required("status");
  setTaskStatus(root, id, nextStatus, options.one("actor") ?? "yoloop", options.one("message") ?? "");
}

function runCriticWriteVerdict(root: string, args: string[]): void {
  const options = parseOptions(args);
  writeCriticVerdict(
    root,
    options.required("task-id"),
    parseVerdictDecision(options.required("verdict")),
    options.required("summary"),
    options.many("check"),
    options.many("gap"),
    options.one("actor") ?? "critic",
  );
}

function runGrandJuryWriteVerdict(root: string, args: string[]): void {
  const options = parseOptions(args);
  writeGrandJuryVerdict(
    root,
    parseVerdictDecision(options.required("verdict")),
    options.required("summary"),
    options.many("check"),
    options.many("gap"),
    options.one("actor") ?? "grand-jury",
  );
}

function runAdapterCommand(root: string, args: string[]): void {
  const options = parseOptions(args);
  warnDeprecatedFlag(options, "execute", "adapter run now executes by default");
  const adapter = options.one("adapter") ?? "claude-code";
  const role = AgentRoleSchema.parse(options.required("role"));
  runAdapter(root, adapter, role, options.flag("dry-run"));
}

function runLogAppend(root: string, args: string[]): void {
  const options = parseOptions(args);
  appendHumanLog(root, {
    kind: parseHumanLogKind(options.required("kind")),
    taskId: options.one("task-id"),
    actor: options.one("actor") ?? "worker",
    summary: options.required("summary"),
    body: options.many("body").join("\n\n"),
  });
}

function warnDeprecatedFlag(options: ParsedOptions, flag: string, replacement: string): void {
  if (options.flag(flag)) {
    warn(`--${flag} is deprecated; ${replacement}`);
  }
}

function warn(message: string): void {
  console.error(`warning: ${message}`);
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

type ParsedOptions = {
  one(name: string): string | undefined;
  many(name: string): string[];
  required(name: string): string;
  flag(name: string): boolean;
};

function parseOptions(args: string[]): ParsedOptions {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      fail(`unexpected argument ${arg}`);
    }
    const withoutPrefix = arg.slice(2);
    const equals = withoutPrefix.indexOf("=");
    if (equals >= 0) {
      addValue(values, withoutPrefix.slice(0, equals), withoutPrefix.slice(equals + 1));
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      addValue(values, withoutPrefix, next);
      index += 1;
    } else {
      flags.add(withoutPrefix);
    }
  }
  return {
    one(name: string): string | undefined {
      return values.get(name)?.[0];
    },
    many(name: string): string[] {
      return values.get(name) ?? [];
    },
    required(name: string): string {
      const value = values.get(name)?.[0];
      if (!value) {
        fail(`missing --${name}`);
      }
      return value;
    },
    flag(name: string): boolean {
      return flags.has(name);
    },
  };
}

function addValue(values: Map<string, string[]>, name: string, value: string): void {
  const existing = values.get(name) ?? [];
  existing.push(value);
  values.set(name, existing);
}
