import { mulberry32 } from "./rng";
import {
  RESOURCE_KINDS,
  TIER_PRIORITY,
  type AgentSpec,
  type AgentStat,
  type AgentTier,
  type FairnessPolicy,
  type RecoveryMode,
  type ResourceAmount,
  type ResourceKind,
  type Scenario,
  type ResolvedTaskSpec,
  type ResolvedThresholds,
  type SimulationResult,
  type TaskOutcome,
  type TaskSpec,
} from "./types";

export interface PendingTask {
  spec: ResolvedTaskSpec;
  attempts: number;
  enqueuedTick: number;
  lastDispatchedTick: number;
  done: boolean;
}

export const FAIRNESS_POLICIES: FairnessPolicy[] = [
  "fifo",
  "strict_priority",
  "weighted_fair",
  "deadline_aware",
];

const DEFAULT_MAX_TICKS = 200;
const DEFAULT_MAX_RETRIES = 2;
const AGING_PER_TICK = 10;

export function effectivePriority(tier: AgentTier, waitedTicks: number): number {
  return TIER_PRIORITY[tier] + waitedTicks * AGING_PER_TICK;
}

function tierWeight(tier: AgentTier): number {
  switch (tier) {
    case "critical":
      return 8;
    case "high":
      return 6;
    case "normal":
      return 4;
    case "background":
      return 2;
    default:
      return 1;
  }
}

export class BudgetTracker {
  private readonly initial: Record<ResourceKind, number>;
  private readonly consumed: Record<ResourceKind, number>;

  constructor(initial: ResourceAmount) {
    this.initial = { tokens: 0, api_calls: 0, dollars: 0, ...initial };
    this.consumed = { tokens: 0, api_calls: 0, dollars: 0 };
  }

  remaining(kind: ResourceKind): number {
    return this.initial[kind] - this.consumed[kind];
  }

  isAffordable(cost: ResourceAmount): boolean {
    return this.canAfford(cost) === null;
  }

  canAfford(cost: ResourceAmount): ResourceKind | null {
    for (const kind of RESOURCE_KINDS) {
      if ((cost[kind] ?? 0) > this.remaining(kind)) return kind;
    }
    return null;
  }

  refill(amount: ResourceAmount): void {
    for (const kind of RESOURCE_KINDS) {
      this.consumed[kind] = Math.max(0, this.consumed[kind] - (amount[kind] ?? 0));
    }
  }

  spend(cost: ResourceAmount): void {
    for (const kind of RESOURCE_KINDS) this.consumed[kind] += cost[kind] ?? 0;
  }

  snapshot(): {
    initial: Record<ResourceKind, number>;
    consumed: Record<ResourceKind, number>;
    remaining: Record<ResourceKind, number>;
  } {
    const remaining = emptyAmounts();
    for (const kind of RESOURCE_KINDS) remaining[kind] = this.remaining(kind);
    return { initial: { ...this.initial }, consumed: { ...this.consumed }, remaining };
  }
}

export class AgentRegistry {
  private readonly specs = new Map<string, AgentSpec>();

  constructor(specs: AgentSpec[] = []) {
    for (const spec of specs) this.register(spec);
  }

  register(spec: AgentSpec): this {
    if (!spec.id) throw new Error("agent id must be a non-empty string");
    if (this.specs.has(spec.id)) throw new Error(`duplicate agent id: ${spec.id}`);
    this.specs.set(spec.id, spec);
    return this;
  }

  require(id: string): AgentSpec {
    const spec = this.specs.get(id);
    if (!spec) throw new Error(`unknown agent: ${id}`);
    return spec;
  }

  all(): AgentSpec[] {
    return [...this.specs.values()];
  }
}

export class Scheduler {
  constructor(private readonly policy: FairnessPolicy) {}

  order(queue: PendingTask[], served: Map<string, number>, now: number): PendingTask[] {
    const sorted = [...queue];
    const byArrival = (a: PendingTask, b: PendingTask) =>
      a.enqueuedTick - b.enqueuedTick || a.spec.id.localeCompare(b.spec.id);
    switch (this.policy) {
      case "fifo":
        sorted.sort(byArrival);
        break;
      case "strict_priority":
        sorted.sort(
          (a, b) =>
            effectivePriority(b.spec.tier, now - b.enqueuedTick) -
              effectivePriority(a.spec.tier, now - a.enqueuedTick) ||
            (b.spec.priority ?? 0) - (a.spec.priority ?? 0) ||
            byArrival(a, b),
        );
        break;
      case "weighted_fair":
        sorted.sort((a, b) => {
          const left = (served.get(a.spec.agentId) ?? 0) / tierWeight(a.spec.tier);
          const right = (served.get(b.spec.agentId) ?? 0) / tierWeight(b.spec.tier);
          return left - right || byArrival(a, b);
        });
        break;
      case "deadline_aware":
        sorted.sort((a, b) => {
          const left = a.spec.deadline ?? Number.POSITIVE_INFINITY;
          const right = b.spec.deadline ?? Number.POSITIVE_INFINITY;
          return (
            left - right ||
            TIER_PRIORITY[b.spec.tier] - TIER_PRIORITY[a.spec.tier] ||
            byArrival(a, b)
          );
        });
        break;
    }
    return sorted;
  }
}

function emptyAmounts(): Record<ResourceKind, number> {
  return { tokens: 0, api_calls: 0, dollars: 0 };
}

function costOf(spec: TaskSpec): ResourceAmount {
  return { tokens: 0, api_calls: 0, dollars: 0, ...spec.cost };
}

function scaleCost(cost: ResourceAmount, factor: number): ResourceAmount {
  const scaled: ResourceAmount = {};
  for (const kind of RESOURCE_KINDS) {
    const amount = cost[kind];
    if (amount !== undefined) scaled[kind] = amount * factor;
  }
  return scaled;
}

function addAmount(target: Record<ResourceKind, number>, cost: ResourceAmount): void {
  for (const kind of RESOURCE_KINDS) target[kind] += cost[kind] ?? 0;
}

function concurrencyOf(spec: AgentSpec): number {
  return Math.max(1, spec.concurrency ?? 1);
}

function retriesOf(spec: AgentSpec): number {
  return Math.max(0, spec.maxRetries ?? DEFAULT_MAX_RETRIES);
}

function recoveryOf(spec: AgentSpec): RecoveryMode {
  return spec.recovery ?? "retry";
}

export interface SimulatorOptions {
  policy?: FairnessPolicy;
}

function requirePolicy(policy: string): FairnessPolicy {
  if (!FAIRNESS_POLICIES.includes(policy as FairnessPolicy)) {
    throw new Error(`unknown policy "${policy}" (available: ${FAIRNESS_POLICIES.join(", ")})`);
  }
  return policy as FairnessPolicy;
}

export class Simulator {
  constructor(private readonly options: SimulatorOptions = {}) {
    if (options.policy !== undefined) requirePolicy(options.policy);
  }

  run(scenario: Scenario): SimulationResult {
    const policy = requirePolicy(this.options.policy ?? scenario.policy);
    const registry = new AgentRegistry(scenario.agents);
    const budget = new BudgetTracker(scenario.budget);
    const scheduler = new Scheduler(policy);
    const random = mulberry32(scenario.seed ?? 1);
    const maxTicks = scenario.maxTicks ?? DEFAULT_MAX_TICKS;
    const thresholds: ResolvedThresholds = {
      maxWaitTicks: scenario.thresholds?.maxWaitTicks ?? 25,
      minCompletionRate: scenario.thresholds?.minCompletionRate ?? 0.9,
    };

    const stats = new Map<string, AgentStat>();
    for (const spec of registry.all()) {
      stats.set(spec.id, {
        agentId: spec.id,
        tier: spec.tier,
        dispatched: 0,
        completed: 0,
        degraded: 0,
        rejected: 0,
        aborted: 0,
        retries: 0,
        consumed: emptyAmounts(),
      });
    }

    const outcomes: TaskOutcome[] = [];
    const queue: PendingTask[] = scenario.tasks.map((task) => {
      const agent = registry.require(task.agentId);
      return {
        spec: { ...task, tier: agent.tier },
        attempts: 0,
        enqueuedTick: 0,
        lastDispatchedTick: -1,
        done: false,
      };
    });

    const served = new Map<string, number>();
    let currentTick = 0;
    const fail = (task: PendingTask, status: TaskOutcome["status"], reason?: string, recoveredWith?: RecoveryMode) => {
      task.done = true;
      const stat = stats.get(task.spec.agentId)!;
      if (status === "completed") stat.completed += 1;
      if (status === "degraded") stat.degraded += 1;
      if (status === "rejected") stat.rejected += 1;
      if (status === "aborted") stat.aborted += 1;
      outcomes.push({
        taskId: task.spec.id,
        agentId: task.spec.agentId,
        status,
        attempts: task.attempts,
        waitedTicks: Math.max(0, currentTick - task.enqueuedTick),
        reason,
        recoveredWith,
      });
    };

    const fleetCapacity =
      scenario.dispatchSlots ?? registry.all().reduce((sum, spec) => sum + concurrencyOf(spec), 0);
    let tick = 0;
    while (queue.some((task) => !task.done) && tick < maxTicks) {
      currentTick = tick;
      if (scenario.refill) budget.refill(scenario.refill);
      const slots = new Map<string, number>();
      for (const spec of registry.all()) slots.set(spec.id, concurrencyOf(spec));
      let fleetSlots = Math.max(1, fleetCapacity);

      for (const task of scheduler.order(queue, served, tick)) {
        if (task.done || task.lastDispatchedTick === tick) continue;
        if (fleetSlots <= 0) break;
        const available = slots.get(task.spec.agentId) ?? 0;
        if (available <= 0) continue;

        const agent = registry.require(task.spec.agentId);
        const stat = stats.get(task.spec.agentId)!;
        const cost = costOf(task.spec);
        const missing = budget.canAfford(cost);
        if (missing) {
          fail(task, "rejected", `budget exhausted for ${missing}`);
          continue;
        }

        budget.spend(cost);
        addAmount(stat.consumed, cost);
        task.attempts += 1;
        task.lastDispatchedTick = tick;
        stat.dispatched += 1;
        served.set(task.spec.agentId, (served.get(task.spec.agentId) ?? 0) + 1);
        slots.set(task.spec.agentId, available - 1);
        fleetSlots -= 1;

        if (random() >= (agent.failureRate ?? 0)) {
          fail(task, "completed");
          continue;
        }

        const recovery = recoveryOf(agent);
        if (recovery === "retry" && task.attempts <= retriesOf(agent)) {
          stat.retries += 1;
          task.enqueuedTick = tick;
          continue;
        }
        if (recovery === "fallback") {
          const fallbackCost = scaleCost(costOf(task.spec), 0.5);
          if (budget.isAffordable(fallbackCost)) {
            budget.spend(fallbackCost);
            addAmount(stat.consumed, fallbackCost);
            fail(task, "degraded", undefined, "fallback");
            continue;
          }
        }
        if (recovery === "degrade") {
          fail(task, "degraded", undefined, "degrade");
          continue;
        }

        fail(task, "aborted", recovery === "abort" ? "agent aborted after unrecovered failure" : "retries exhausted");
        if (recovery === "abort") {
          for (const other of queue) {
            if (other.done || other.spec.agentId !== task.spec.agentId) continue;
            fail(other, "aborted", "cascaded from upstream abort");
          }
        }
      }
      tick += 1;
    }

    for (const task of queue) {
      if (!task.done) fail(task, "aborted", "tick budget exhausted before dispatch");
    }

    const starved = new Set<string>();
    for (const outcome of outcomes) {
      if (outcome.waitedTicks > thresholds.maxWaitTicks) starved.add(outcome.agentId);
    }

    const snapshot = budget.snapshot();
    return {
      scenario: scenario.name,
      policy,
      seed: scenario.seed ?? 1,
      ticks: tick,
      initialBudget: snapshot.initial,
      consumedBudget: snapshot.consumed,
      remainingBudget: snapshot.remaining,
      tasks: outcomes,
      agents: [...stats.values()],
      starvedAgents: [...starved],
      maxWaitTicks: outcomes.reduce((max, outcome) => Math.max(max, outcome.waitedTicks), 0),
      thresholds,
    };
  }
}
