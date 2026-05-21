import { readFileSync } from "fs";
import { join } from "path";
import { fail } from "./errors";
import { appendEvent, atomicWriteFile, goalIntegrity, nowIso, readTasks } from "./io";
import { DECISIONS_PATH, FAILURES_PATH, PROGRESS_PATH } from "./paths";
import { HumanLogKind, HumanLogKindSchema } from "./schemas";

export type AppendHumanLogInput = {
  kind: HumanLogKind;
  taskId?: string;
  actor: string;
  summary: string;
  body: string;
};

const INSERT_MARKER = "  </section>\n</body>";

export function appendHumanLog(root: string, input: AppendHumanLogInput): void {
  goalIntegrity(root);
  const kind = HumanLogKindSchema.parse(input.kind);
  const taskId = input.taskId?.trim();
  if (taskId) {
    assertTaskExists(root, taskId);
  }

  const timestamp = nowIso();
  const path = logPath(kind);
  const fullPath = join(root, path);
  const current = readLogFile(fullPath);
  if (!current.includes(INSERT_MARKER)) {
    fail(`${path} is not in the expected Yoloop log HTML format`);
  }

  const entry = renderLogEntry({
    kind,
    taskId,
    actor: input.actor,
    summary: input.summary,
    body: input.body,
    timestamp,
  });
  atomicWriteFile(fullPath, current.replace(INSERT_MARKER, `${entry}${INSERT_MARKER}`));
  appendEvent(root, {
    timestamp,
    kind: "human_log.appended",
    actor: input.actor,
    taskId: taskId ?? null,
    message: `Appended ${kind} log entry.`,
    data: { logKind: kind, summary: input.summary },
  });
  console.log(`appended ${kind} log entry to ${path}`);
}

export function parseHumanLogKind(value: string): HumanLogKind {
  return HumanLogKindSchema.parse(value);
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

function readLogFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    fail(`failed to read ${path}: ${formatError(error)}`);
  }
}

function renderLogEntry(input: {
  kind: HumanLogKind;
  taskId: string | undefined;
  actor: string;
  summary: string;
  body: string;
  timestamp: string;
}): string {
  const task = input.taskId ? `<dt>Task</dt><dd><code>${escapeHtml(input.taskId)}</code></dd>\n      ` : "";
  const body = input.body.trim()
    ? `\n    <section class="entry-body">\n      ${paragraphs(input.body)}\n    </section>`
    : "";
  return `    <article class="yoloop-log-entry" data-kind="${input.kind}" data-created-at="${escapeHtml(input.timestamp)}">
      <h2>${escapeHtml(input.summary)}</h2>
      <dl>
      ${task}<dt>Actor</dt><dd>${escapeHtml(input.actor)}</dd>
      <dt>Created</dt><dd><time datetime="${escapeHtml(input.timestamp)}">${escapeHtml(input.timestamp)}</time></dd>
      </dl>${body}
    </article>
`;
}

function paragraphs(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("\n      ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
