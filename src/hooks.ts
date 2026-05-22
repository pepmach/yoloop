import { relative, resolve } from "path";
import { goalIntegrity, readPolicy } from "./io";
import { DECISIONS_PATH, FAILURES_PATH, GOAL_PATH, HUMAN_LOG_PATH, PROGRESS_PATH } from "./paths";
import { HookInputSchema } from "./schemas";

export type HookDecision =
  | { decision: "approve" }
  | { decision: "block"; reason: string };

export function pretooluse(root: string, rawInput: string): HookDecision {
  if (rawInput.trim() === "") {
    return { decision: "approve" };
  }

  const input = HookInputSchema.parse(JSON.parse(rawInput));
  const toolInput =
    input.tool_input && typeof input.tool_input === "object" && !Array.isArray(input.tool_input)
      ? (input.tool_input as Record<string, unknown>)
      : {};
  const policy = readPolicy(root);
  if (!policy.active) {
    return { decision: "approve" };
  }

  if (isMutatingTool(input.tool_name)) {
    try {
      goalIntegrity(root);
    } catch (error) {
      return { decision: "block", reason: `${GOAL_PATH} changed while loop is active: ${formatError(error)}` };
    }
  }

  if (input.tool_name.toLowerCase() === "bash") {
    const command = typeof toolInput.command === "string" ? toolInput.command : undefined;
    if (command) {
      const lowerCommand = command.toLowerCase();
      for (const denied of policy.denyShellSubstrings) {
        if (lowerCommand.includes(denied.toLowerCase())) {
          return { decision: "block", reason: `command contains denied substring ${JSON.stringify(denied)}` };
        }
      }
      const appendOnlyLogPath = directAppendOnlyLogWrite(command);
      if (appendOnlyLogPath) {
        return {
          decision: "block",
          reason: `${appendOnlyLogPath} is append-only; use yoloop log append instead of direct shell writes`,
        };
      }
    }
  }

  for (const path of hookFilePaths(root, toolInput)) {
    const normalized = normalizePathForPolicy(root, path);
    if (pathMatchesAny(normalized, appendOnlyLogPaths())) {
      return { decision: "block", reason: `${normalized} is append-only; use yoloop log append` };
    }
    if (pathMatchesAny(normalized, policy.immutablePaths)) {
      return { decision: "block", reason: `${normalized} is immutable while yoloop is active` };
    }
    if (pathMatchesAny(normalized, policy.protectedPathsWhileActive)) {
      return { decision: "block", reason: `${normalized} is protected while yoloop is active` };
    }
  }

  return { decision: "approve" };
}

export function printHookDecision(decision: HookDecision): void {
  console.log(JSON.stringify(decision));
}

function isMutatingTool(toolName: string): boolean {
  return ["bash", "write", "edit", "multiedit", "notebookedit"].includes(toolName.toLowerCase());
}

function hookFilePaths(root: string, toolInput: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const key of ["file_path", "path", "notebook_path"]) {
    const value = toolInput[key];
    if (typeof value === "string") {
      paths.push(resolve(root, value));
    }
  }
  return paths;
}

function normalizePathForPolicy(root: string, path: string): string {
  return trimDot(relative(root, path).replace(/\\/g, "/"));
}

function trimDot(value: string): string {
  return value.replace(/^[.][\\/]/, "");
}

function pathMatchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => pathMatches(path, pattern));
}

function directAppendOnlyLogWrite(command: string): string | undefined {
  if (!looksLikeShellWrite(command)) {
    return undefined;
  }
  const lower = command.toLowerCase().replace(/\\/g, "/");
  return appendOnlyLogPaths().find((path) => lower.includes(path.toLowerCase()));
}

function looksLikeShellWrite(command: string): boolean {
  const lower = command.toLowerCase();
  return [">", ">>", "set-content", "add-content", "out-file", "tee "].some((token) => lower.includes(token));
}

function appendOnlyLogPaths(): string[] {
  return [HUMAN_LOG_PATH, PROGRESS_PATH, FAILURES_PATH, DECISIONS_PATH].map((path) => path.replace(/\\/g, "/"));
}

function pathMatches(path: string, pattern: string): boolean {
  const normalizedPattern = trimDot(pattern.replace(/\\/g, "/"));
  if (normalizedPattern.endsWith("/")) {
    return path === normalizedPattern.slice(0, -1) || path.startsWith(normalizedPattern);
  }
  if (!normalizedPattern.includes("*")) {
    return path === normalizedPattern;
  }
  const regex = new RegExp(`^${escapeRegex(normalizedPattern).replace(/\\\*/g, ".*")}$`);
  return regex.test(path);
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
