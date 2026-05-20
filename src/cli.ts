#!/usr/bin/env node
import { run } from "./main";

try {
  run(process.argv.slice(2), process.cwd());
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
}
