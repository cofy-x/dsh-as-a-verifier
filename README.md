# dsh-as-a-verifier

English | [中文](README.zh.md)

`dsh-as-a-verifier` is a standalone DeepSeek Harness function plugin that compares trajectories, selects the best of N with a Probabilistic Pivot Tournament (PPT), and scores progress along one trajectory. It provides `ctx.verifier` plus the model-facing `verifier_select` and `verifier_track` tools.

The native TypeScript implementation derives pairwise reward, PPT, and offline/online A–T progress tracking from llm-as-a-verifier (<https://github.com/llm-as-a-verifier/llm-as-a-verifier>) at commit `8db8a114355a9d7fdf9a8d1d5c87f6aeebd18770`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Install

This repository is Git-installable and intentionally has `private: true`; npm publication is not supported in the MVP.

```sh
dsh plugin --profile web add github:omdsh-dev/dsh-as-a-verifier
dsh plugin --profile headless add github:omdsh-dev/dsh-as-a-verifier
```

An unqualified GitHub spec resolves the repository's default branch when pnpm installs or updates it. The selected commit is then frozen by the Profile lockfile; restarting DSH does not silently advance it. Update explicitly and restart the Profile:

```sh
dsh plugin --profile web update dsh-as-a-verifier
```

A Git install executes this package's self-contained `prepare` build. pnpm 10 and newer require a one-time explicit authorization in the selected profile's `pnpm-workspace.yaml`; copy the package key from the first installation error, then retry:

```yaml
allowBuilds:
  dsh-as-a-verifier: true
```

For a reproducible stable deployment, pin the immutable release tag (or an audited commit):

```sh
dsh plugin --profile web add github:omdsh-dev/dsh-as-a-verifier#v0.2.4
```

Release tags are created only from a validated merge on `main` and are never moved. Backward-compatible fixes and capability additions increment the patch version; public API additions increment the minor version; an incompatible `ctx.verifier` contract requires a new protocol version and a major release.

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
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
pnpm run prepare
```

Every pull request and `main` update runs the keyless suite on Ubuntu and Windows with Node 24 and the exact minimum Node 22.19.0, followed by an exact-commit Git-install smoke on Node 24. A source-contract gate pins the audited DSH `dsh-v0.1.2-alpha.1` release (`cd5ef8148158c3a752a658978873241fdf8e2bbc`) and verifies the imported provider seams. The stable `ci / required` result is the protected-branch merge gate. Actions have read-only repository permission and receive no DeepSeek credential.

Releases remain deliberate and Git-only. Run the read-only `release-check` workflow against the exact current `main` commit and package version, then create an annotated tag. A tag-triggered release check verifies the annotation, version, `main` ancestry, complete keyless suite, and installation from the tag. After it is green, publish a non-draft, non-prerelease GitHub Release for the immutable tag. The workflow never creates or moves tags and never publishes npm artifacts. Real-provider e2e remains outside CI; it is required in the release evidence when backend, prompt, or score-decoder behavior changes and otherwise self-skips without `DEEPSEEK_API_KEY`.

## Boundaries

This package does not include `verified_ralph`, multimodal inputs, Vertex/OpenAI-compatible backends, a Web panel, coding worktrees, price conversion, or a transparent model proxy. `dsh-verified-ralph` is a separate consumer plugin.

## License

[MIT](LICENSE). The upstream attribution and complete upstream MIT notice are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
