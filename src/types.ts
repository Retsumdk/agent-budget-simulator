export type ResourceKind = "tokens" | "api_calls" | "dollars";

export const RESOURCE_KINDS: ResourceKind[] = ["tokens", "api_calls", "dollars"];

export type AgentTier = "critical" | "high" | "normal" | "background" | "best_effort";

export const TIER_PRIORITY: Record<AgentTier, number> = {
  critical: 500,
  high: 400,
  normal: 300,
  background: 200,
  best_effort: 100,
};

export type FairnessPolicy = "fifo" | "strict_priority" | "weighted_fair" | "deadline_aware";

export type RecoveryMode = "retry" | "degrade" | "fallback" | "abort";

export type TaskStatus = "completed" | "degraded" | "rejected" | "aborted";

export type ResourceAmount = Partial<Record<ResourceKind, number>>;

export interface AgentSpec {
  id: string;
  tier: AgentTier;
  concurrency?: number;
  failureRate?: number;
  recovery?: RecoveryMode;
  maxRetries?: number;
}

export interface TaskSpec {
  id: string;
  agentId: string;
  cost: ResourceAmount;
  tier?: AgentTier;
  priority?: number;
  deadline?: number;
}

export type ResolvedTaskSpec = TaskSpec & { tier: AgentTier };

export interface ScenarioThresholds {
  maxWaitTicks?: number;
  minCompletionRate?: number;
}

export interface Scenario {
  name: string;
  description: string;
  policy: FairnessPolicy;
  budget: ResourceAmount;
  agents: AgentSpec[];
  tasks: TaskSpec[];
  seed?: number;
  maxTicks?: number;
  dispatchSlots?: number;
  refill?: ResourceAmount;
  thresholds?: ScenarioThresholds;
}

export interface ResolvedThresholds {
  maxWaitTicks: number;
  minCompletionRate: number;
}

export interface TaskOutcome {
  taskId: string;
  agentId: string;
  status: TaskStatus;
  attempts: number;
  waitedTicks: number;
  reason?: string;
  recoveredWith?: RecoveryMode;
}

export interface AgentStat {
  agentId: string;
  tier: AgentTier;
  dispatched: number;
  completed: number;
  degraded: number;
  rejected: number;
  aborted: number;
  retries: number;
  consumed: Record<ResourceKind, number>;
}

export interface SimulationResult {
  scenario: string;
  policy: FairnessPolicy;
  seed: number;
  ticks: number;
  initialBudget: Record<ResourceKind, number>;
  consumedBudget: Record<ResourceKind, number>;
  remainingBudget: Record<ResourceKind, number>;
  tasks: TaskOutcome[];
  agents: AgentStat[];
  starvedAgents: string[];
  maxWaitTicks: number;
  thresholds: ResolvedThresholds;
}

export interface ResourceLine {
  kind: ResourceKind;
  initial: number;
  consumed: number;
  remaining: number;
  utilization: number;
}

export interface AgentLine {
  agentId: string;
  tier: AgentTier;
  dispatched: number;
  completed: number;
  degraded: number;
  rejected: number;
  aborted: number;
  retries: number;
}

export type FleetStatus = "healthy" | "constrained" | "starved" | "critical";

export interface ScenarioReport {
  scenario: string;
  policy: FairnessPolicy;
  seed: number;
  ticks: number;
  totals: {
    total: number;
    completed: number;
    degraded: number;
    rejected: number;
    aborted: number;
  };
  completionRate: number;
  resources: ResourceLine[];
  agents: AgentLine[];
  fairness: {
    maxWaitTicks: number;
    starvedAgents: string[];
    satisfied: boolean;
  };
  status: FleetStatus;
  verdict: "PASS" | "FAIL";
  reasons: string[];
}

export interface ResourceSummary {
  kind: ResourceKind;
  initial: number;
  consumed: number;
  remaining: number;
  utilization: number;
}
