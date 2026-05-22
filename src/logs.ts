import { appendFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fail } from "./errors";
import { appendEvent, atomicWriteFile, ensureDir, goalIntegrity, nowIso, readTasks } from "./io";
import { DECISIONS_PATH, FAILURES_PATH, HUMAN_LOG_PATH, PROGRESS_PATH } from "./paths";
import { HumanLogEntry, HumanLogEntrySchema, HumanLogKind, HumanLogKindSchema } from "./schemas";

export type AppendHumanLogInput = {
  kind: HumanLogKind;
  taskId?: string;
  actor: string;
  summary: string;
  body: string;
};

export function appendHumanLog(root: string, input: AppendHumanLogInput): void {
  goalIntegrity(root);
  const kind = HumanLogKindSchema.parse(input.kind);
  const taskId = input.taskId?.trim() || null;
  if (taskId) {
    assertTaskExists(root, taskId);
  }

  const timestamp = nowIso();
  const entry = HumanLogEntrySchema.parse({
    schemaVersion: 1,
    kind,
    taskId,
    actor: input.actor,
    summary: input.summary,
    body: input.body,
    createdAt: timestamp,
  });

  appendHumanLogEntry(root, entry);
  renderHumanLogMarkdown(root, kind);
  appendEvent(root, {
    timestamp,
    kind: "human_log.appended",
    actor: input.actor,
    taskId,
    message: `Appended ${kind} log entry.`,
    data: { logKind: kind, summary: input.summary },
  });
  console.log(`appended ${kind} log entry to ${logPath(kind)}`);
}

export function parseHumanLogKind(value: string): HumanLogKind {
  return HumanLogKindSchema.parse(value);
}

export function emptyLogMarkdown(title: string): string {
  return `# ${title}\n\nNo entries yet.\n`;
}

function appendHumanLogEntry(root: string, entry: HumanLogEntry): void {
  const path = join(root, HUMAN_LOG_PATH);
  ensureDir(dirname(path));
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

function renderHumanLogMarkdown(root: string, kind: HumanLogKind): void {
  const entries = readHumanLogEntries(root).filter((entry) => entry.kind === kind);
  const title = logTitle(kind);
  const body =
    entries.length === 0
      ? emptyLogMarkdown(title)
      : `# ${title}\n\n${entries.map(renderMarkdownEntry).join("\n")}`;
  atomicWriteFile(join(root, logPath(kind)), body);
}

function readHumanLogEntries(root: string): HumanLogEntry[] {
  const path = join(root, HUMAN_LOG_PATH);
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    fail(`failed to read ${HUMAN_LOG_PATH}: ${formatError(error)}`);
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = HumanLogEntrySchema.safeParse(JSON.parse(line) as unknown);
      if (!parsed.success) {
        fail(`parse ${HUMAN_LOG_PATH}: ${parsed.error.message}`);
      }
      return parsed.data;
    });
}

function assertTaskExists(root: string, taskId: string): void {
  const task = readTasks(root).tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    fail(`task ${taskId} not found in TASKS.json`);
  }
}

function logPath(kind: HumanLogKind): string {
  switch (kind) {
    case "progress":
      return PROGRESS_PATH;
    case "failure":
      return FAILURES_PATH;
    case "decision":
      return DECISIONS_PATH;
  }
}

function logTitle(kind: HumanLogKind): string {
  switch (kind) {
    case "progress":
      return "Progress";
    case "failure":
      return "Failures";
    case "decision":
      return "Decisions";
  }
}

function renderMarkdownEntry(entry: HumanLogEntry): string {
  const task = entry.taskId ? `- Task: \`${escapeInlineCode(entry.taskId)}\`\n` : "";
  const body = entry.body.trim() ? `\n${entry.body.trim()}\n` : "";
  return `## ${singleLine(entry.summary)}

${task}- Actor: ${singleLine(entry.actor)}
- Created: ${entry.createdAt}
${body}`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, "\\`");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
