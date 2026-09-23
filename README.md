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

This package is **not published on the npm registry**, so there is no `bun add`
for it yet — run it from a clone:

```bash
git clone https://github.com/Retsumdk/agent-budget-simulator.git
cd agent-budget-simulator
bun install
```

There is no build step to consume it: the sources are TypeScript, Bun runs them
directly, so import from the clone:

```ts
import {
  evaluateScenario,
  formatResult,
  stressScenario,
  Simulator,
} from "./src/index.ts";

const sim = new Simulator();
const result = evaluateScenario(sim.run(stressScenario));
console.log(formatResult(result));
```

Run the bundled demo and tests:

```bash
bun start       # run the demo scenario (stress)
bun test        # run the test suite (28 tests)
bun run build   # type-check and build with tsc
```

## Example output

`bun run src/index.ts --scenario starvation` prints:

```text
Scenario: starvation   policy=strict_priority   seed=11   ticks=15
Tasks: 18 total | 14 completed | 0 degraded | 4 rejected | 0 aborted
Completion rate: 77.8%

Resource            Initial     Consumed    Remaining   Utilization
tokens                13200        13200            0       100.0%
api_calls               200            0          200         0.0%
dollars                   3            0            3         0.0%

Agent                     Tier         Dispatch  Complete  Degrade  Reject  Abort  Retries
critical-bot             critical           10        10        0       0      0        0
normal-bot               normal              4         4        0       0      0        0
background-bot           background          0         0        0       4      0        0

Fairness: max wait 14 ticks | starved agents: background-bot | threshold missed
Status: STARVED   Verdict: FAIL
Notes:
  - starved agents: background-bot (max wait 14 ticks > limit 13)
  - 4 task(s) rejected for an exhausted resource
```

Exit status is `0` when the scenario runs, and `1` for an unknown scenario or policy name.

## Real Use Case

A team running a fleet of background and critical agents with a shared token budget can simulate a **starvation scenario** to verify the scheduler still lets critical work complete while background work is degraded — before deploying a new `weighted_fair` policy. The simulator reports per-resource consumption, task status distribution, and whether the fleet met its fairness thresholds.

## License

MIT — see [LICENSE](LICENSE).
