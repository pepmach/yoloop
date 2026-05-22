import { z } from "zod";

export const AgentRoleSchema = z.enum(["worker", "critic", "grand-jury"]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const HumanLogKindSchema = z.enum(["progress", "failure", "decision"]);
export type HumanLogKind = z.infer<typeof HumanLogKindSchema>;

export const HumanLogEntrySchema = z
  .object({
    schemaVersion: z.number().int(),
    kind: HumanLogKindSchema,
    taskId: z.string().nullable(),
    actor: z.string(),
    summary: z.string(),
    body: z.string(),
    createdAt: z.string(),
  })
  .strict();
export type HumanLogEntry = z.infer<typeof HumanLogEntrySchema>;

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

export const CheckKindSchema = z.enum(["build", "lint", "typecheck", "test", "integration", "check"]);
export type CheckKind = z.infer<typeof CheckKindSchema>;

export const TaskRiskSchema = z.enum(["low", "medium", "high"]);
export type TaskRisk = z.infer<typeof TaskRiskSchema>;

export const CheckCommandSchema = z
  .object({
    kind: CheckKindSchema,
    name: z.string().min(1),
    command: z.string().min(1),
    source: z.string().min(1),
    packageManager: z.string().min(1).optional(),
  })
  .strict();
export type CheckCommand = z.infer<typeof CheckCommandSchema>;

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
    checks: z.array(CheckCommandSchema),
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
    milestoneId: z.string().min(1),
    title: z.string(),
    description: z.string(),
    successCriteria: z.array(z.string().min(1)),
    status: TaskStatusSchema,
    priority: z.number().int(),
    risk: TaskRiskSchema,
    attempts: z.number().int(),
    claimedBy: z.string().nullable(),
    dependsOn: z.array(z.string()),
    allowedPaths: z.array(z.string()),
    checks: z.array(z.string().min(1)),
    gates: z.array(z.string().min(1)),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const MilestoneSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    taskIds: z.array(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const TaskLedgerSchema = z
  .object({
    schemaVersion: z.number().int(),
    milestones: z.array(MilestoneSchema),
    tasks: z.array(TaskSchema),
  })
  .strict();
export type Task = z.infer<typeof TaskSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
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

export const GrandJuryVerdictSchema = z
  .object({
    schemaVersion: z.number().int(),
    verdict: VerdictDecisionSchema,
    summary: z.string(),
    checks: z.array(VerdictCheckSchema),
    gaps: z.array(z.string()),
    tasksReviewed: z.array(z.string()),
    createdAt: z.string(),
  })
  .strict();
export type GrandJuryVerdict = z.infer<typeof GrandJuryVerdictSchema>;

export const DecompositionVerdictSchema = z
  .object({
    schemaVersion: z.number().int(),
    verdict: VerdictDecisionSchema,
    summary: z.string(),
    checks: z.array(VerdictCheckSchema),
    gaps: z.array(z.string()),
    goalSha256: z.string(),
    planSha256: z.string(),
    policySha256: z.string(),
    tasksSha256: z.string(),
    createdAt: z.string(),
  })
  .strict();
export type DecompositionVerdict = z.infer<typeof DecompositionVerdictSchema>;

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

export const ContextManifestFileSchema = z
  .object({
    path: z.string(),
    bytes: z.number().int(),
    sha256: z.string(),
    mediaType: z.string(),
  })
  .strict();

export const ContextManifestSchema = z
  .object({
    schemaVersion: z.number().int(),
    rawDir: z.string(),
    generatedAt: z.string(),
    files: z.array(ContextManifestFileSchema),
  })
  .strict();
export type ContextManifest = z.infer<typeof ContextManifestSchema>;

export const HookInputSchema = z
  .object({
    tool_name: z.string(),
    tool_input: z.unknown().optional(),
  })
  .passthrough();
export type HookInput = z.infer<typeof HookInputSchema>;
