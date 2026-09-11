# agent-budget-simulator
Scenario simulator for testing agent fleet budgets, priority policies, and failure recovery under load
## Overview

`agent-budget-simulator` is a deterministic TypeScript scenario simulator for testing **agent fleet budgets, priority policies, and failure recovery under load** before you ship them to production. It is designed for infrastructure engineers and agent-orchestration teams who need to answer "what happens when my fleet runs out of tokens, API quota, or budget" without risking a live system.

## Why it exists

Simulating a fleet is far cheaper and safer than discovering a starvation or budget-exhaustion bug in production. This library models the resource budget, priority, scheduling, and failure-recovery behavior of an agent fleet so you can:

- Prove a **priority policy** is fair under contention.
- Find **starvation** scenarios before they hit real agents.
- Validate **failure recovery** behavior (retry / abort / degrade / fallback) under load.

## Features

- **Budget tracking** across resource kinds: `tokens`, `api_calls`, `dollars`.
- **Agent tiers** — `critical`, `high`, `normal`, `background`, `best_effort` — with effective-priority computation.
- **Fairness policies** — `fifo`, `strict_priority`, `weighted_fair`, `deadline_aware`.
- **Packaged scenarios** — `baseline`, `stress`, `starvation`, `deadline`, `tokenBucket`.
- **Reporting** — `evaluateScenario`, `formatResult`, and `summarizeByResource` helpers.

## Architecture

```
              ┌────────────────────────────────────────────┐
 task queue → │  Scheduler (priority + fairness policy)     │
              └──────────────┬─────────────────────────────┘
                             │ dispatch
              ┌──────────────▼─────────────┐
 agents ────► │  Agent / AgentRegistry      │
              └──────────────┬─────────────┘
                             │ consume
              ┌──────────────▼─────────────┐
              │  BudgetTracker (per resource) │
              └──────────────┬─────────────┘
                             │ outcome
              ┌──────────────▼─────────────┐
              │  evaluateScenario / report │
              └────────────────────────────┘
```

## Install & Usage

Requires [Bun](https://bun.sh) and TypeScript 5.

```bash
bun add @retsumdk/agent-budget-simulator
```

```ts
import { Simulator, stressScenario, evaluateScenario } from "@retsumdk/agent-budget-simulator";

const sim = new Simulator();
const result = evaluateScenario(sim.run(stressScenario));
console.log(formatResult(result));
```

Run the bundled demo and tests:

```bash
bun start       # run the demo scenario
bun test        # run the test suite
bun run build   # type-check and build with tsc
```

## Real Use Case

A team running a fleet of background and critical agents with a shared token budget can simulate a **starvation scenario** to verify the scheduler still lets critical work complete while background work is degraded — before deploying a new `weighted_fair` policy. The simulator reports per-resource consumption, task status distribution, and whether the fleet met its fairness thresholds.

## License

MIT — see [LICENSE](LICENSE).
