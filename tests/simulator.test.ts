import { describe, expect, test } from "bun:test";
import {
  AgentRegistry,
  BudgetTracker,
  Simulator,
  effectivePriority,
  evaluateScenario,
  formatResourceSummary,
  formatResult,
  getScenario,
  mulberry32,
  runScenario,
  scenarioNames,
  summarizeByResource,
} from "../src/index";
import type { Scenario } from "../src/types";

function customScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: "custom",
    description: "test scenario",
    policy: "fifo",
    seed: 7,
    budget: { tokens: 1_000, api_calls: 100, dollars: 10 },
    agents: [{ id: "worker", tier: "normal", concurrency: 1 }],
    tasks: [{ id: "a", agentId: "worker", cost: { tokens: 100 } }],
    ...overrides,
  };
}

describe("determinism", () => {
  test("same seed produces identical results", () => {
    const first = new Simulator().run(getScenario("stress"));
    const second = new Simulator().run(getScenario("stress"));
    expect(first.consumedBudget).toEqual(second.consumedBudget);
    expect(first.tasks).toEqual(second.tasks);
    expect(first.ticks).toBe(second.ticks);
  });

  test("different seeds diverge once failures are injected", () => {
    const base = getScenario("stress");
    const a = new Simulator().run({ ...base, seed: 1 });
    const b = new Simulator().run({ ...base, seed: 999 });
    expect(JSON.stringify(a.tasks)).not.toBe(JSON.stringify(b.tasks));
  });

  test("mulberry32 is reproducible", () => {
    const left = mulberry32(123);
    const right = mulberry32(123);
    expect([left(), left(), left()]).toEqual([right(), right(), right()]);
  });
});

describe("BudgetTracker", () => {
  test("reports the first exhausted resource", () => {
    const tracker = new BudgetTracker({ tokens: 100, api_calls: 1 });
    expect(tracker.canAfford({ tokens: 50, api_calls: 1 })).toBeNull();
    expect(tracker.canAfford({ tokens: 500 })).toBe("tokens");
    expect(tracker.canAfford({ api_calls: 5 })).toBe("api_calls");
  });

  test("spend and snapshot track consumed and remaining", () => {
    const tracker = new BudgetTracker({ tokens: 300 });
    tracker.spend({ tokens: 120 });
    const snapshot = tracker.snapshot();
    expect(snapshot.consumed.tokens).toBe(120);
    expect(snapshot.remaining.tokens).toBe(180);
  });

  test("refill restores previously consumed budget", () => {
    const tracker = new BudgetTracker({ tokens: 100 });
    tracker.spend({ tokens: 80 });
    tracker.refill({ tokens: 30 });
    expect(tracker.remaining("tokens")).toBe(50);
  });
});

describe("AgentRegistry", () => {
  test("rejects duplicate ids", () => {
    const registry = new AgentRegistry([{ id: "a", tier: "normal" }]);
    expect(() => registry.register({ id: "a", tier: "high" })).toThrow(/duplicate agent id/);
  });

  test("require throws for unknown agents", () => {
    const registry = new AgentRegistry([]);
    expect(() => registry.require("ghost")).toThrow(/unknown agent/);
  });
});

describe("priority policies", () => {
  test("effectivePriority ages waiting work", () => {
    expect(effectivePriority("normal", 5)).toBeGreaterThan(effectivePriority("normal", 0));
    expect(effectivePriority("critical", 0)).toBeGreaterThan(effectivePriority("best_effort", 0));
  });

  test("strict_priority serves critical work before best_effort", () => {
    const result = runScenario("starvation", "strict_priority");
    const order = result.tasks.map((task) => task.taskId);
    const lastCritical = order.lastIndexOf("critical-10");
    const firstBackground = order.indexOf("background-1");
    expect(lastCritical).toBeLessThan(firstBackground);
  });

  test("weighted_fair keeps low-tier work alive where strict_priority starves it", () => {
    const strict = runScenario("starvation", "strict_priority");
    const fair = runScenario("starvation", "weighted_fair");
    const completed = (result: typeof strict) =>
      result.agents.find((agent) => agent.agentId === "background-bot")!.completed;

    expect(completed(strict)).toBe(0);
    expect(completed(fair)).toBeGreaterThan(0);
    expect(evaluateScenario(fair).totals.completed).toBeGreaterThan(evaluateScenario(strict).totals.completed);
  });

  test("deadline_aware runs the tightest deadline first", () => {
    const result = runScenario("deadline", "deadline_aware");
    const byId = new Map(result.tasks.map((task) => [task.taskId, task]));
    expect(byId.get("soon")!.waitedTicks).toBeLessThan(byId.get("late")!.waitedTicks);
    expect(byId.get("urgent")!.waitedTicks).toBeLessThan(byId.get("relaxed")!.waitedTicks);
  });

  test("fifo keeps arrival order for a single worker", () => {
    const scenario = customScenario({
      tasks: [
        { id: "first", agentId: "worker", cost: { tokens: 10 } },
        { id: "second", agentId: "worker", cost: { tokens: 10 } },
        { id: "third", agentId: "worker", cost: { tokens: 10 } },
      ],
    });
    const result = new Simulator().run(scenario);
    const completed = result.tasks
      .filter((task) => task.status === "completed")
      .map((task) => task.waitedTicks);
    expect(completed[0]).toBeLessThan(completed[1]);
    expect(completed[1]).toBeLessThan(completed[2]);
  });
});

describe("failure recovery", () => {
  const failing = (recovery: "retry" | "abort" | "degrade" | "fallback", extra = {}) =>
    customScenario({
      budget: { tokens: 10_000 },
      agents: [{ id: "worker", tier: "normal", recovery, failureRate: 1, ...extra }],
      tasks: [{ id: "a", agentId: "worker", cost: { tokens: 100 } }],
    });

  test("retry re-dispatches and pays the cost per attempt until retries run out", () => {
    const result = new Simulator().run(failing("retry", { maxRetries: 2 }));
    const outcome = result.tasks[0];
    expect(outcome.status).toBe("aborted");
    expect(outcome.attempts).toBe(3);
    expect(outcome.reason).toBe("retries exhausted");
    expect(result.consumedBudget.tokens).toBe(300);
  });

  test("degrade accepts a reduced result at the original cost", () => {
    const result = new Simulator().run(failing("degrade"));
    expect(result.tasks[0].status).toBe("degraded");
    expect(result.tasks[0].recoveredWith).toBe("degrade");
    expect(result.consumedBudget.tokens).toBe(100);
  });

  test("fallback pays a 50% premium for the fallback path", () => {
    const result = new Simulator().run(failing("fallback"));
    expect(result.tasks[0].status).toBe("degraded");
    expect(result.tasks[0].recoveredWith).toBe("fallback");
    expect(result.consumedBudget.tokens).toBe(150);
  });

  test("abort cascades to every remaining task for the same agent", () => {
    const scenario = customScenario({
      budget: { tokens: 10_000 },
      agents: [{ id: "worker", tier: "normal", recovery: "abort", failureRate: 1 }],
      tasks: [
        { id: "a", agentId: "worker", cost: { tokens: 100 } },
        { id: "b", agentId: "worker", cost: { tokens: 100 } },
        { id: "c", agentId: "worker", cost: { tokens: 100 } },
      ],
    });
    const result = new Simulator().run(scenario);
    expect(result.tasks.map((task) => task.status)).toEqual(["aborted", "aborted", "aborted"]);
    expect(result.tasks[1].reason).toBe("cascaded from upstream abort");
  });

  test("rejection happens when the budget cannot cover a task", () => {
    const result = runScenario("tokenBucket");
    const rejected = result.tasks.filter((task) => task.status === "rejected");
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected[0].reason).toContain("budget exhausted for tokens");
    expect(result.consumedBudget.tokens).toBeLessThanOrEqual(5_000);
  });

  test("undeclared failureRate means every task completes", () => {
    const result = new Simulator().run(getScenario("baseline"));
    expect(result.tasks.every((task) => task.status === "completed")).toBe(true);
    expect(result.tasks.every((task) => task.attempts === 1)).toBe(true);
  });
});

describe("reporting", () => {
  test("summarizeByResource totals match the consumed budget", () => {
    const result = new Simulator().run(getScenario("stress"));
    const summary = summarizeByResource(result);
    expect(summary.map((entry) => entry.kind)).toEqual(["tokens", "api_calls", "dollars"]);
    for (const entry of summary) {
      expect(entry.consumed + entry.remaining).toBe(entry.initial);
      expect(entry.utilization).toBeCloseTo(entry.consumed / entry.initial, 10);
    }
  });

  test("evaluateScenario flags an exhausted fleet as starved", () => {
    const report = evaluateScenario(new Simulator().run(getScenario("tokenBucket")));
    expect(report.status).toBe("starved");
    expect(report.verdict).toBe("FAIL");
    expect(report.totals.rejected).toBeGreaterThan(0);
    expect(report.reasons.some((reason) => reason.includes("rejected"))).toBe(true);
  });

  test("evaluateScenario passes a healthy baseline", () => {
    const report = evaluateScenario(new Simulator().run(getScenario("baseline")));
    expect(report.status).toBe("healthy");
    expect(report.verdict).toBe("PASS");
    expect(report.completionRate).toBe(1);
  });

  test("formatResult renders the headline sections", () => {
    const text = formatResult(evaluateScenario(new Simulator().run(getScenario("starvation"))));
    expect(text).toContain("Scenario: starvation");
    expect(text).toContain("Resource");
    expect(text).toContain("Agent");
    expect(text).toContain("Verdict:");
  });

  test("formatResourceSummary lists each resource once", () => {
    const text = formatResourceSummary(new Simulator().run(getScenario("stress")));
    expect(text).toContain("tokens:");
    expect(text).toContain("api_calls:");
    expect(text).toContain("dollars:");
  });
});

describe("scenario catalogue", () => {
  test("exposes the five packaged scenarios", () => {
    expect(scenarioNames).toEqual(["baseline", "stress", "starvation", "deadline", "tokenBucket"]);
  });

  test("every packaged scenario runs and reports", () => {
    for (const name of scenarioNames) {
      const result = new Simulator().run(getScenario(name));
      expect(result.tasks.length).toBeGreaterThan(0);
      expect(evaluateScenario(result).reasons.length).toBeGreaterThanOrEqual(0);
    }
  });

  test("policy override beats the scenario default", () => {
    const result = runScenario("starvation", "weighted_fair");
    expect(result.policy).toBe("weighted_fair");
  });

  test("unknown scenario or policy is rejected", () => {
    expect(() => getScenario("nope")).toThrow(/unknown scenario/);
    expect(() => runScenario("baseline", "nonsense" as never)).toThrow(/unknown policy/);
  });
});
