# Changelog

All notable changes to `agent-budget-simulator` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-09-23

First tagged release. `agent-budget-simulator` runs a deterministic fleet
simulation in-process — no network, no clock, no randomness outside a seeded
generator — so the same scenario and seed always produce the same report.

### Added

- **Budget tracking** across three resource kinds (`tokens`, `api_calls`,
  `dollars`), with consumption, remaining balance and utilisation reported per
  resource.
- **Agent tiers** — `critical`, `high`, `normal`, `background`, `best_effort` —
  with effective-priority computation, so a policy can express a two-level
  ordering that neither a plain numeric priority nor a queue order can.
- **Fairness policies** — `fifo`, `strict_priority`, `weighted_fair`,
  `deadline_aware`. The same task set and seed can be replayed under every
  policy to compare starvation behaviour.
- **Packaged scenarios** — `baseline`, `stress`, `starvation`, `deadline`,
  `tokenBucket`, each pinned to its own seed and policy.
- **Failure recovery** — per-task outcomes of `complete`, `degrade`, `reject`
  and `abort`, with retry accounting.
- **Reporting** — `evaluateScenario`, `formatResult` and `summarizeByResource`
  build the human-readable report and the one-line summary.
- **CLI** — `--scenario`, `--policy`, `--json`, `--summary`, `--all`, `--list`
  and `--compare`, with a non-zero exit status for an unknown scenario or
  policy name.
- **Test suite** — 28 tests covering scheduling, budget exhaustion, fairness
  thresholds and failure recovery.
- **README** — architecture diagram, verified example output for the
  `starvation` scenario, and a documented real use case.

### Fixed

- The README's install instructions pointed at
  `bun add @retsumdk/agent-budget-simulator`, which cannot resolve: the package
  is not published on the npm registry. Direct installs are replaced with a
  from-clone quickstart and an import path that matches the repository layout.

### Notes

- The package is consumed as TypeScript source. `bun run build` emits `dist/`
  with `tsc` for type checking and for bundlers that want JavaScript, but Bun
  runs the sources directly and no build step is required to use the library.
