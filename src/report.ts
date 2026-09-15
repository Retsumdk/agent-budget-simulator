import {
  RESOURCE_KINDS,
  type AgentLine,
  type FleetStatus,
  type ResourceKind,
  type ResourceSummary,
  type ScenarioReport,
  type SimulationResult,
  type TaskStatus,
} from "./types";

const STATUS_ORDER: TaskStatus[] = ["completed", "degraded", "rejected", "aborted"];

export function summarizeByResource(result: SimulationResult): ResourceSummary[] {
  return RESOURCE_KINDS.map((kind) => ({
    kind,
    initial: result.initialBudget[kind],
    consumed: result.consumedBudget[kind],
    remaining: result.remainingBudget[kind],
    utilization: result.initialBudget[kind] > 0 ? result.consumedBudget[kind] / result.initialBudget[kind] : 0,
  }));
}

export function statusBreakdown(result: SimulationResult): Record<TaskStatus, number> {
  const counts = { completed: 0, degraded: 0, rejected: 0, aborted: 0 };
  for (const status of STATUS_ORDER) {
    counts[status] = result.tasks.filter((task) => task.status === status).length;
  }
  return counts;
}

export function consumedByKind(result: SimulationResult, kind: ResourceKind): number {
  return result.consumedBudget[kind];
}

function toAgentLines(result: SimulationResult): AgentLine[] {
  return result.agents.map((agent) => ({
    agentId: agent.agentId,
    tier: agent.tier,
    dispatched: agent.dispatched,
    completed: agent.completed,
    degraded: agent.degraded,
    rejected: agent.rejected,
    aborted: agent.aborted,
    retries: agent.retries,
  }));
}

export function totalRetries(result: SimulationResult): number {
  return result.tasks.reduce((sum, task) => sum + Math.max(0, task.attempts - 1), 0);
}

export function evaluateScenario(result: SimulationResult): ScenarioReport {
  const totals = statusBreakdown(result);
  const completed = result.tasks.length === 0 ? 1 : (totals.completed + totals.degraded) / result.tasks.length;
  const resources = summarizeByResource(result);

  const starvationSatisfied = result.starvedAgents.length === 0 && result.maxWaitTicks <= result.thresholds.maxWaitTicks;
  const completionSatisfied = completed >= result.thresholds.minCompletionRate;
  const budgetSatisfied = resources.every((resource) => resource.utilization <= 1);

  const reasons: string[] = [];
  if (!starvationSatisfied) {
    reasons.push(
      result.starvedAgents.length > 0
        ? `starved agents: ${result.starvedAgents.join(", ")} (max wait ${result.maxWaitTicks} ticks > limit ${result.thresholds.maxWaitTicks})`
        : `max wait ${result.maxWaitTicks} ticks exceeds limit ${result.thresholds.maxWaitTicks}`,
    );
  }
  if (!completionSatisfied) {
    reasons.push(
      `completion rate ${(completed * 100).toFixed(1)}% below required ${(result.thresholds.minCompletionRate * 100).toFixed(1)}%`,
    );
  }
  if (totals.rejected > 0) reasons.push(`${totals.rejected} task(s) rejected for an exhausted resource`);
  if (totals.aborted > 0) reasons.push(`${totals.aborted} task(s) aborted after unrecovered failure`);

  let status: FleetStatus;
  if (!budgetSatisfied || totals.rejected > 0) status = "starved";
  else if (!starvationSatisfied) status = "constrained";
  else if (!completionSatisfied || totals.aborted > 0) status = "constrained";
  else status = "healthy";

  return {
    scenario: result.scenario,
    policy: result.policy,
    seed: result.seed,
    ticks: result.ticks,
    totals: { total: result.tasks.length, ...totals },
    completionRate: completed,
    resources,
    agents: toAgentLines(result),
    fairness: {
      maxWaitTicks: result.maxWaitTicks,
      starvedAgents: result.starvedAgents,
      satisfied: starvationSatisfied,
    },
    status,
    verdict: status === "healthy" ? "PASS" : "FAIL",
    reasons,
  };
}

export function formatResult(report: ScenarioReport): string {
  const lines: string[] = [];
  lines.push(`Scenario: ${report.scenario}   policy=${report.policy}   seed=${report.seed}   ticks=${report.ticks}`);
  lines.push(
    `Tasks: ${report.totals.total} total | ${report.totals.completed} completed | ${report.totals.degraded} degraded | ${report.totals.rejected} rejected | ${report.totals.aborted} aborted`,
  );
  lines.push(`Completion rate: ${(report.completionRate * 100).toFixed(1)}%`);
  lines.push("");
  lines.push("Resource            Initial     Consumed    Remaining   Utilization");
  for (const resource of report.resources) {
    lines.push(
      [
        resource.kind.padEnd(18),
        String(resource.initial).padStart(8),
        String(resource.consumed).padStart(12),
        String(resource.remaining).padStart(12),
        `${(resource.utilization * 100).toFixed(1)}%`.padStart(12),
      ].join(" "),
    );
  }
  lines.push("");
  lines.push("Agent                     Tier         Dispatch  Complete  Degrade  Reject  Abort  Retries");
  for (const agent of report.agents) {
    lines.push(
      [
        agent.agentId.padEnd(24),
        agent.tier.padEnd(12),
        String(agent.dispatched).padStart(8),
        String(agent.completed).padStart(9),
        String(agent.degraded).padStart(8),
        String(agent.rejected).padStart(7),
        String(agent.aborted).padStart(6),
        String(agent.retries).padStart(8),
      ].join(" "),
    );
  }
  lines.push("");
  lines.push(
    `Fairness: max wait ${report.fairness.maxWaitTicks} ticks | starved agents: ${
      report.fairness.starvedAgents.length > 0 ? report.fairness.starvedAgents.join(", ") : "none"
    } | threshold ${report.fairness.satisfied ? "met" : "missed"}`,
  );
  lines.push(`Status: ${report.status.toUpperCase()}   Verdict: ${report.verdict}`);
  if (report.reasons.length > 0) {
    lines.push("Notes:");
    for (const reason of report.reasons) lines.push(`  - ${reason}`);
  }
  return lines.join("\n");
}

export function formatResourceSummary(result: SimulationResult): string {
  return summarizeByResource(result)
    .map(
      (resource) =>
        `${resource.kind}: ${resource.consumed}/${resource.initial} (${(resource.utilization * 100).toFixed(1)}%)`,
    )
    .join("   ");
}
