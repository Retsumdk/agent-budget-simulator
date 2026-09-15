#!/usr/bin/env bun
import { Command } from "commander";
import { FAIRNESS_POLICIES, Simulator } from "./core";
import { evaluateScenario, formatResourceSummary, formatResult } from "./report";
import { getScenario, scenarioNames, scenarios } from "./scenarios";
import type { FairnessPolicy, Scenario, SimulationResult } from "./types";

export { Simulator, effectivePriority, BudgetTracker, AgentRegistry, Scheduler } from "./core";
export { mulberry32 } from "./rng";
export {
  baselineScenario,
  deadlineScenario,
  getScenario,
  scenarioNames,
  scenarios,
  starvationScenario,
  stressScenario,
  tierOrder,
  tokenBucketScenario,
} from "./scenarios";
export { evaluateScenario, formatResult, formatResourceSummary, summarizeByResource, statusBreakdown } from "./report";
export type * from "./types";

export function allScenarios(): Scenario[] {
  return Object.values(scenarios);
}

export function resolveScenario(name: string): Scenario {
  const scenario = allScenarios().find((entry) => entry.name === name);
  if (!scenario) {
    const available = allScenarios().map((entry) => entry.name).join(", ");
    throw new Error(`unknown scenario "${name}" (available: ${available})`);
  }
  return scenario;
}

export function runScenario(name: string, policy?: FairnessPolicy): SimulationResult {
  return new Simulator({ policy }).run(getScenario(name));
}

function renderRun(result: SimulationResult, json: boolean, summaryOnly: boolean): void {
  if (json) {
    console.log(JSON.stringify({ result, report: evaluateScenario(result) }, null, 2));
    return;
  }
  if (summaryOnly) {
    console.log(`${result.scenario} [${result.policy}] ${formatResourceSummary(result)}`);
    return;
  }
  console.log(formatResult(evaluateScenario(result)));
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("agent-budget-simulator")
    .description("Simulate agent fleet budgets, priority policies, and failure recovery under load.")
    .option("-s, --scenario <name>", "scenario to run (baseline, stress, starvation, deadline, tokenBucket)", "stress")
    .option("-p, --policy <policy>", `fairness policy (${FAIRNESS_POLICIES.join(", ")})`)
    .option("--json", "emit the raw result and report as JSON", false)
    .option("--summary", "print a one-line resource summary", false)
    .option("--all", "run every packaged scenario and print its status", false)
    .option("--list", "list packaged scenarios", false)
    .option("--compare", "run the selected scenario under every fairness policy", false);

  program.parse(process.argv);
  const options = program.opts<{
    scenario: string;
    policy?: FairnessPolicy;
    json: boolean;
    summary: boolean;
    all: boolean;
    list: boolean;
    compare: boolean;
  }>();

  if (options.policy && !FAIRNESS_POLICIES.includes(options.policy)) {
    throw new Error(`unknown policy "${options.policy}" (available: ${FAIRNESS_POLICIES.join(", ")})`);
  }

  if (options.list) {
    for (const scenario of allScenarios()) {
      console.log(`${scenario.name.padEnd(14)} ${scenario.description}`);
    }
    return;
  }

  if (options.all) {
    for (const scenario of allScenarios()) {
      const result = new Simulator({ policy: options.policy }).run(scenario);
      const report = evaluateScenario(result);
      console.log(
        `${scenario.name.padEnd(14)} policy=${report.policy.padEnd(15)} status=${report.status.padEnd(12)} verdict=${report.verdict}  ${formatResourceSummary(result)}`,
      );
    }
    return;
  }

  if (options.compare) {
    for (const policy of FAIRNESS_POLICIES) {
      const result = runScenario(options.scenario, policy);
      const report = evaluateScenario(result);
      console.log(
        `${policy.padEnd(15)} status=${report.status.padEnd(11)} completion=${(report.completionRate * 100).toFixed(1)}%  maxWait=${report.fairness.maxWaitTicks}  starved=${
          report.fairness.starvedAgents.length
        }`,
      );
    }
    return;
  }

  renderRun(runScenario(options.scenario, options.policy), options.json, options.summary);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
