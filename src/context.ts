import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { appendEvent, ensureDir, nowIso, prettyJson, readJson, writeJson } from "./io";
import { CONTEXT_MANIFEST_PATH, RAW_DIR } from "./paths";
import { ContextManifest, ContextManifestSchema } from "./schemas";

export function refreshContextManifest(root: string, actor = "yoloop", quiet = false): ContextManifest {
  ensureDir(join(root, RAW_DIR));
  const manifest: ContextManifest = {
    schemaVersion: 1,
    rawDir: RAW_DIR,
    generatedAt: nowIso(),
    files: scanRawFiles(root),
  };
  writeJson(join(root, CONTEXT_MANIFEST_PATH), ContextManifestSchema, manifest);
  appendEvent(root, {
    timestamp: manifest.generatedAt,
    kind: "context.manifest_refreshed",
    actor,
    taskId: null,
    message: "Refreshed raw context manifest.",
    data: { fileCount: manifest.files.length },
  });
  if (!quiet) {
    console.log(`context manifest: ${manifest.files.length} file(s)`);
  }
  return manifest;
}

export function emptyContextManifest(): string {
  return prettyJson({
    schemaVersion: 1,
    rawDir: RAW_DIR,
    generatedAt: nowIso(),
    files: [],
  });
}

export function readContextManifest(root: string): ContextManifest {
  return readJson(join(root, CONTEXT_MANIFEST_PATH), ContextManifestSchema, CONTEXT_MANIFEST_PATH);
}

function scanRawFiles(root: string): ContextManifest["files"] {
  const rawRoot = join(root, RAW_DIR);
  if (!existsSync(rawRoot)) {
    return [];
  }
  const files: ContextManifest["files"] = [];
  const stack = [rawRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current)) {
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }
      const bytes = readFileSync(fullPath);
      const path = relative(root, fullPath).replace(/\\/g, "/");
      files.push({
        path,
        bytes: stat.size,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        mediaType: inferMediaType(path),
      });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function inferMediaType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "text/markdown";
  }
  if (lower.endsWith(".txt")) {
    return "text/plain";
  }
  if (lower.endsWith(".json")) {
    return "application/json";
  }
  if (lower.endsWith(".jsonl")) {
    return "application/x-ndjson";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "text/html";
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "application/yaml";
  }
  if (lower.endsWith(".csv")) {
    return "text/csv";
  }
  return "application/octet-stream";
}
