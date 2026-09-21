# dsh-as-a-verifier

English | [中文](README.zh.md)

`dsh-as-a-verifier` is a standalone DeepSeek Harness function plugin that compares trajectories, selects the best of N with a Probabilistic Pivot Tournament (PPT), and scores progress along one trajectory. It provides `ctx.verifier` plus the model-facing `verifier_select` and `verifier_track` tools.

The native TypeScript implementation derives pairwise reward, PPT, and offline/online A–T progress tracking from llm-as-a-verifier (<https://github.com/llm-as-a-verifier/llm-as-a-verifier>) at commit `8db8a114355a9d7fdf9a8d1d5c87f6aeebd18770`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Install

This repository is Git-installable and intentionally has `private: true`; it is not published to npm.

```sh
dsh plugin --profile web add github:cofy-x/dsh-as-a-verifier
dsh plugin --profile headless add github:cofy-x/dsh-as-a-verifier
```

The default-branch install resolves once and is frozen by the Profile lockfile. Update explicitly, then restart the Profile:

```sh
dsh plugin --profile web update dsh-as-a-verifier
```

A Git install runs this package's self-contained `prepare` build. Add the exact key reported by pnpm to `$DSH_HOME/profiles/<profile>/pnpm-workspace.yaml`, then retry:

```yaml
allowBuilds:
  dsh-as-a-verifier@https://codeload.github.com/cofy-x/dsh-as-a-verifier/tar.gz/<resolved-commit>: true
```

Use the exact key printed by pnpm. The content-addressed key authorizes only that resolved Git archive; a package-name-wide approval is intentionally not used.

For a reproducible deployment, pin an immutable release tag (or an audited commit):

```sh
dsh plugin --profile web add github:cofy-x/dsh-as-a-verifier#v0.2.6
```

After installation, `dsh --profile web --dump-config` or the corresponding Headless profile should show exactly one `dsh-as-a-verifier` row.

Set `DEEPSEEK_API_KEY` in a Harness-supported credential source or launch environment. Missing credentials do not block plugin loading or the single-candidate fast path; the first operation that needs the API fails clearly.

## API

The function plugin exports `name`, `inject`, `Config`, and `apply` with no default export. It requires only `tools`; credentials and launch-environment services are optional. Consumers can fail early against incompatible providers through `ctx.verifier.protocolVersion` and feature-test `ctx.verifier.capabilities` before starting work.

```ts
const comparison = await ctx.verifier.compare({
  problem: 'Fix the failing parser tests.',
  traceA: 'candidate A trajectory',
  traceB: 'candidate B trajectory',
  criteria: [{
    id: 'correctness',
    name: 'Correctness',
    description: 'Prefer a complete fix supported by passing tests.',
  }],
})

const selection = await ctx.verifier.select({
  problem: 'Fix the failing parser tests.',
  candidates: ['trajectory 0', 'trajectory 1', 'trajectory 2'],
  criteria: [{
    id: 'correctness',
    name: 'Correctness',
    description: 'Prefer a complete fix supported by passing tests.',
  }],
  nEvaluations: 2,
  pivots: 2,
  seed: 0,
})

const progress = await ctx.verifier.track({
  problem: 'Fix the failing parser tests.',
  steps: ['Inspected the failure.', 'Edited the parser.', 'Ran the tests successfully.'],
  checkpointSteps: [1, 3],
})

const tracker = ctx.verifier.createProgressTracker({ problem: 'Fix the failing parser tests.' })
await tracker.update('Inspected the failure and reproduced it.')
await tracker.update('Implemented the fix and ran the focused tests.')
const onlineProgress = tracker.result()
await tracker.dispose()
```

`compare()` returns rewards in `[0, 1]`, per-criterion rewards, actual verifier calls, and token usage. `select()` returns `selectedIndex`, `best`, a complete index ranking, scores in candidate-index order, comparison and call counts, the validated criteria, and token usage. A one-candidate selection returns immediately without credentials or network traffic.

`track()` returns strict checkpoint scores, raw per-evaluation curves, final score, calls, and usage. With more than two steps its default checkpoints are `2..T-1`; shorter trajectories score every step. Checkpoints are 1-based, unique, and strictly increasing. `createProgressTracker()` scores only the prefix available at each update, so later steps cannot influence earlier scores.

The `verifier_select` tool accepts the same problem, string candidates, and criteria. Its optional arguments are named `n_evaluations`, `pivots`, and `seed`; deployment ceilings always win over tool input. `verifier_track` accepts `problem`, `steps`, optional `checkpoint_steps`, and `n_evaluations`. Both use generic cards and declare no file locations.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `model` | `deepseek-v4-flash` | DeepSeek verifier model |
| `baseURL` | `DEEPSEEK_BASE_URL`, else `https://api.deepseek.com` | API origin; the chat-completions path is appended |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential reference, never a secret value |
| `reasoningEffort` | `high` | `off`, `low`, `high`, or `max` |
| `maxTokens` | `32768` | Maximum completion tokens |
| `nEvaluations` / `maxEvaluations` | `2` / `8` | Default and deployment ceiling for repeated scoring |
| `pivots` / `maxPivots` | `2` / `8` | Default and deployment ceiling for PPT pivots |
| `maxCandidates` | `16` | Candidate ceiling |
| `maxCriteria` | `8` | Criterion ceiling |
| `maxProgressSteps` | `256` | Progress trajectory step ceiling |
| `maxProgressCheckpoints` | `64` | Checkpoints scored in one request |
| `maxProgressStepChars` | `32768` | Character ceiling for one step |
| `maxProgressTrajectoryChars` | `262144` | Total progress trajectory character ceiling |
| `maxConcurrency` | `8` | Maximum simultaneous HTTP calls |
| `requestTimeoutMs` | `120000` | Timeout for each HTTP attempt |
| `retryAttempts` | `3` | Total bounded attempts for retryable failures |
| `cacheEnabled` | `true` | Enable persistent numeric score cache |
| `dataDir` | `$DSH_HOME/as-a-verifier` | Plugin data directory |

Self-contained errors such as invalid URLs, non-positive limits, or defaults above ceilings fail at load. Empty inputs, duplicate criterion IDs, and request values above deployment ceilings fail before network access.

## Scoring, cost, and failures

Each criterion asks the verifier for an A–T score per candidate. The reward is the normalized expectation over valid top-logprob alternatives at the exact score position, not a parsed integer or a sampled letter. Odd repetitions exchange prompt slots to reduce A/B position bias. Criteria are placed at the prompt tail; the first criterion warms each shared trajectory prefix before remaining criterion calls expand under `maxConcurrency`.

For `N > 1` candidates and `k = min(pivots, N)`, PPT performs:

```text
comparisons = N + k(N - k) + k(k - 1) / 2
verifier calls = comparisons × criteria × nEvaluations
```

`compare()` uses `criteria × nEvaluations` calls. Offline progress uses exactly `nEvaluations` calls regardless of checkpoint count; online progress uses `nEvaluations` calls per update. Cache hits reduce actual calls and current-operation usage to zero for those scores. Provider billing depends on the returned cached/uncached input, output, and reasoning token counts.

Missing score-position logprobs, no valid A–T alternatives, malformed JSON, invalid usage, and any partial scoring failure reject the whole operation. The plugin never fabricates a `0.5/0.5` tie or `0.5` progress score, and progress never falls back to sampled response text. Only transport failures, HTTP 429, and HTTP 5xx are retried; authentication, protocol, and content failures are not. A valid `Retry-After` is honored within a bounded delay. Fiber disposal stops admission, aborts active requests, and waits for them to settle.

## Cache and data disclosure

Pairwise and progress caches use separate versioned namespaces. Progress identity covers backend, model, prompt version, problem, complete steps, checkpoints, and repeat. Pairwise identity covers prompt/schema version, backend, model, problem, ordered candidates, complete criterion, repetition, and slot order. Every identity is hashed with SHA-256. Versioned entries are atomically replaced with owner-only permissions; corrupt or incompatible entries are misses.

Cache files contain only numeric rewards and token usage. They do not store the raw task, trajectories, prompts, model responses, API keys, or reasoning traces. API calls necessarily send the problem and relevant trajectory content to the configured DeepSeek endpoint: either two candidates and one criterion, or the progress steps and checkpoints. Credentials are resolved immediately before every HTTP request and never enter configuration, logs, cache entries, or test snapshots.

## Development

```sh
corepack enable pnpm
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
pnpm run prepare
```

The audited DSH/Node/pnpm baseline is recorded in [docs/dsh-compatibility.md](docs/dsh-compatibility.md). CI runs the keyless suite on Linux and Windows, validates installation from the exact PR commit (including fork PRs), and boots clean Web and Headless profiles. `ci / required` is the merge gate.

Releases are Git-only and manual: validate the exact `main` SHA with `release-check`, create an annotated immutable tag, wait for the tag check, then publish a non-draft GitHub Release. Real-provider E2E stays outside CI and is required when backend, prompt, or decoder behavior changes.

## Boundaries

This package does not include `verified_ralph`, multimodal inputs, Vertex/OpenAI-compatible backends, a Web panel, coding worktrees, price conversion, or a transparent model proxy. `dsh-verified-ralph` is a separate consumer plugin.

## License

[MIT](LICENSE). The upstream attribution and complete upstream MIT notice are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
