import { createHash, randomBytes } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { ZodSchema } from "zod";
import { fail } from "./errors";
import {
  ADAPTERS_PATH,
  EVENTS_PATH,
  GOAL_HASH_PATH,
  GOAL_PATH,
  POLICY_PATH,
  TASKS_PATH,
} from "./paths";
import {
  AdapterCatalog,
  AdapterCatalogSchema,
  Event,
  EventSchema,
  LoopPolicy,
  LoopPolicySchema,
  TaskLedger,
  TaskLedgerSchema,
} from "./schemas";

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeNew(path: string, content: string, force: boolean): void {
  if (existsSync(path) && !force) {
    return;
  }
  atomicWriteFile(path, content);
}

export function atomicWriteFile(path: string, content: string): void {
  ensureDir(dirname(path));
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  writeFileSync(tempPath, content, "utf8");
  renameSync(tempPath, path);
}

export function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function readJson<T>(path: string, schema: ZodSchema<T>, label: string): T {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const result = schema.safeParse(parsed);
  if (!result.success) {
    fail(`parse ${label}: ${result.error.message}`);
  }
  return result.data;
}

export function writeJson<T>(path: string, schema: ZodSchema<T>, value: T): void {
  const result = schema.safeParse(value);
  if (!result.success) {
    fail(`refusing to write invalid JSON state: ${result.error.message}`);
  }
  atomicWriteFile(path, prettyJson(result.data));
}

export function readPolicy(root: string): LoopPolicy {
  return readJson(join(root, POLICY_PATH), LoopPolicySchema, POLICY_PATH);
}

export function readTasks(root: string): TaskLedger {
  return readJson(join(root, TASKS_PATH), TaskLedgerSchema, TASKS_PATH);
}

export function readAdapters(root: string): AdapterCatalog {
  return readJson(join(root, ADAPTERS_PATH), AdapterCatalogSchema, ADAPTERS_PATH);
}

export function goalHash(root: string): string {
  const bytes = readFileSync(join(root, GOAL_PATH));
  return createHash("sha256").update(bytes).digest("hex");
}

export function goalIntegrity(root: string): string {
  const expected = readFileSync(join(root, GOAL_HASH_PATH), "utf8").trim();
  const actual = goalHash(root);
  if (expected !== actual) {
    fail(`GOAL.html hash mismatch: expected ${expected}, actual ${actual}`);
  }
  return "hash matches";
}

export function appendEvent(root: string, event: Event): void {
  const result = EventSchema.safeParse(event);
  if (!result.success) {
    fail(`refusing to append invalid event: ${result.error.message}`);
  }
  const path = join(root, EVENTS_PATH);
  ensureDir(dirname(path));
  appendFileSync(path, `${JSON.stringify(result.data)}\n`, "utf8");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function acceptCurrentGoalHash(root: string): string {
  const hash = goalHash(root);
  atomicWriteFile(join(root, GOAL_HASH_PATH), `${hash}\n`);
  return hash;
}
