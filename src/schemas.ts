import { z } from "zod";

export const AgentRoleSchema = z.enum(["worker", "critic", "grand-jury"]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "critic_review",
  "completed",
  "cancelled",
  "blocked",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const VerdictDecisionSchema = z.enum([
  "approved",
  "rejected",
  "human_approval_required",
]);
export type VerdictDecision = z.infer<typeof VerdictDecisionSchema>;

export const CheckStatusSchema = z.enum(["passed", "failed", "skipped"]);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const HumanGateSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    pathGlobs: z.array(z.string()),
    commandSubstrings: z.array(z.string()),
  })
  .strict();

export const LoopPolicySchema = z
  .object({
    schemaVersion: z.number().int(),
    active: z.boolean(),
    maxIterations: z.number().int(),
    maxWallClockMinutes: z.number().int(),
    maxRetriesPerTask: z.number().int(),
    immutablePaths: z.array(z.string()),
    protectedPathsWhileActive: z.array(z.string()),
    allowedWriteRoots: z.array(z.string()),
    denyShellSubstrings: z.array(z.string()),
    humanGates: z.array(HumanGateSchema),
  })
  .strict();
export type LoopPolicy = z.infer<typeof LoopPolicySchema>;

export const AgentAdapterSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    command: z.string(),
    workerArgs: z.array(z.string()),
    criticArgs: z.array(z.string()),
    grandJuryArgs: z.array(z.string()),
  })
  .strict();

export const AdapterCatalogSchema = z
  .object({
    schemaVersion: z.number().int(),
    adapters: z.array(AgentAdapterSchema),
  })
  .strict();
export type AgentAdapter = z.infer<typeof AgentAdapterSchema>;
export type AdapterCatalog = z.infer<typeof AdapterCatalogSchema>;

export const TaskSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    status: TaskStatusSchema,
    priority: z.number().int(),
    attempts: z.number().int(),
    claimedBy: z.string().nullable(),
    dependsOn: z.array(z.string()),
    allowedPaths: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const TaskLedgerSchema = z
  .object({
    schemaVersion: z.number().int(),
    tasks: z.array(TaskSchema),
  })
  .strict();
export type Task = z.infer<typeof TaskSchema>;
export type TaskLedger = z.infer<typeof TaskLedgerSchema>;

export const VerdictCheckSchema = z
  .object({
    name: z.string(),
    status: CheckStatusSchema,
    evidence: z.string(),
  })
  .strict();

export const CriticVerdictSchema = z
  .object({
    schemaVersion: z.number().int(),
    taskId: z.string(),
    verdict: VerdictDecisionSchema,
    summary: z.string(),
    checks: z.array(VerdictCheckSchema),
    gaps: z.array(z.string()),
    createdAt: z.string(),
  })
  .strict();
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;
export type VerdictCheck = z.infer<typeof VerdictCheckSchema>;

export const EventSchema = z
  .object({
    timestamp: z.string(),
    kind: z.string(),
    actor: z.string(),
    taskId: z.string().nullable(),
    message: z.string(),
    data: z.record(z.unknown()),
  })
  .strict();
export type Event = z.infer<typeof EventSchema>;

export const HookInputSchema = z
  .object({
    tool_name: z.string(),
    tool_input: z.unknown().optional(),
  })
  .passthrough();
export type HookInput = z.infer<typeof HookInputSchema>;
