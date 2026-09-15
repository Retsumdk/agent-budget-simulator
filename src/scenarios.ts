import type { AgentTier, ResourceAmount, ResourceKind, Scenario, TaskSpec } from "./types";

function cost(amount: Partial<Record<ResourceKind, number>>): ResourceAmount {
  return { tokens: 0, api_calls: 0, dollars: 0, ...amount };
}

function task(
  id: string,
  agentId: string,
  tokens: number,
  extra: Partial<Omit<TaskSpec, "id" | "agentId" | "cost">> = {},
): TaskSpec {
  return { id, agentId, cost: cost({ tokens }), ...extra };
}

export const baselineScenario: Scenario = {
  name: "baseline",
  description: "Steady fleet with comfortable budget and no injected failures.",
  seed: 7,
  policy: "fifo",
  budget: cost({ tokens: 120_000, api_calls: 400, dollars: 6 }),
  agents: [
    { id: "planner", tier: "critical", concurrency: 2 },
    { id: "researcher", tier: "high", concurrency: 2 },
    { id: "summarizer", tier: "normal", concurrency: 2 },
    { id: "indexer", tier: "background", concurrency: 1 },
  ],
  tasks: [
    task("plan-1", "planner", 400),
    task("plan-2", "planner", 400),
    task("research-1", "researcher", 900),
    task("research-2", "researcher", 900),
    task("research-3", "researcher", 900),
    task("summary-1", "summarizer", 300),
    task("summary-2", "summarizer", 300),
    task("index-1", "indexer", 200),
    task("index-2", "indexer", 200),
  ],
  thresholds: { maxWaitTicks: 12, minCompletionRate: 0.9 },
};

export const stressScenario: Scenario = {
  name: "stress",
  description:
    "Overloaded fleet: five agents competing for a shared budget with injected worker failures.",
  seed: 42,
  policy: "weighted_fair",
  budget: cost({ tokens: 30_000, api_calls: 60, dollars: 1.5 }),
  agents: [
    { id: "planner", tier: "critical", concurrency: 2, failureRate: 0.1 },
    { id: "researcher", tier: "high", concurrency: 2, failureRate: 0.2 },
    { id: "summarizer", tier: "normal", concurrency: 2, recovery: "degrade" },
    { id: "indexer", tier: "background", concurrency: 1, recovery: "fallback", failureRate: 0.25 },
    { id: "telemetry", tier: "best_effort", concurrency: 1, failureRate: 0.3 },
  ],
  tasks: Array.from({ length: 30 }, (_, index) => {
    const agents = ["planner", "researcher", "summarizer", "indexer", "telemetry"];
    const agentId = agents[index % agents.length];
    return task(`task-${index + 1}`, agentId, 1_200, {
      deadline: 8 + (index % 6),
      priority: index % 3,
    });
  }),
  thresholds: { maxWaitTicks: 10, minCompletionRate: 0.7 },
};

export const starvationScenario: Scenario = {
  name: "starvation",
  description:
    "A critical workload saturates the fleet while low-tier background work waits behind it.",
  seed: 11,
  policy: "strict_priority",
  dispatchSlots: 1,
  budget: cost({ tokens: 13_200, api_calls: 200, dollars: 3 }),
  agents: [
    { id: "critical-bot", tier: "critical", concurrency: 1 },
    { id: "normal-bot", tier: "normal", concurrency: 1 },
    { id: "background-bot", tier: "background", concurrency: 1 },
  ],
  tasks: [
    ...Array.from({ length: 10 }, (_, index) => task(`critical-${index + 1}`, "critical-bot", 1_000)),
    ...Array.from({ length: 4 }, (_, index) => task(`normal-${index + 1}`, "normal-bot", 800)),
    ...Array.from({ length: 4 }, (_, index) => task(`background-${index + 1}`, "background-bot", 600)),
  ],
  thresholds: { maxWaitTicks: 13, minCompletionRate: 0.7 },
};

export const deadlineScenario: Scenario = {
  name: "deadline",
  description:
    "Mixed deadlines under a tight budget, used to probe the deadline_aware policy ordering.",
  seed: 5,
  policy: "deadline_aware",
  budget: cost({ tokens: 20_000, api_calls: 150, dollars: 2 }),
  agents: [
    { id: "worker-a", tier: "normal", concurrency: 1 },
    { id: "worker-b", tier: "normal", concurrency: 1 },
  ],
  tasks: [
    task("late", "worker-a", 900, { deadline: 30 }),
    task("soon", "worker-b", 900, { deadline: 1 }),
    task("middle", "worker-a", 900, { deadline: 6 }),
    task("urgent", "worker-b", 900, { deadline: 2 }),
    task("relaxed", "worker-a", 900, { deadline: 40 }),
  ],
  thresholds: { maxWaitTicks: 8, minCompletionRate: 0.8 },
};

export const tokenBucketScenario: Scenario = {
  name: "tokenBucket",
  description:
    "Token budget drains first so later tasks are rejected for the missing resource type.",
  seed: 3,
  policy: "fifo",
  budget: cost({ tokens: 5_000, api_calls: 1_000, dollars: 50 }),
  agents: [
    { id: "token-heavy", tier: "high", concurrency: 1 },
    { id: "api-heavy", tier: "normal", concurrency: 1 },
  ],
  tasks: [
    { id: "tokens-1", agentId: "token-heavy", cost: cost({ tokens: 2_000, api_calls: 5 }) },
    { id: "tokens-2", agentId: "token-heavy", cost: cost({ tokens: 2_000, api_calls: 5 }) },
    { id: "tokens-3", agentId: "token-heavy", cost: cost({ tokens: 4_000, api_calls: 5 }) },
    { id: "api-1", agentId: "api-heavy", cost: cost({ tokens: 100, api_calls: 50, dollars: 0.25 }) },
    { id: "api-2", agentId: "api-heavy", cost: cost({ api_calls: 200, dollars: 1 }) },
  ],
  thresholds: { maxWaitTicks: 6, minCompletionRate: 0.4 },
};

export const scenarios: Record<string, Scenario> = {
  baseline: baselineScenario,
  stress: stressScenario,
  starvation: starvationScenario,
  deadline: deadlineScenario,
  tokenBucket: tokenBucketScenario,
};

export const scenarioNames = Object.keys(scenarios);

export function getScenario(name: string): Scenario {
  const scenario = scenarios[name];
  if (!scenario) {
    throw new Error(`unknown scenario "${name}" (available: ${scenarioNames.join(", ")})`);
  }
  return scenario;
}

export const tierOrder: AgentTier[] = [
  "critical",
  "high",
  "normal",
  "background",
  "best_effort",
];
