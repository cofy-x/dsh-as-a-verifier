# dsh-as-a-verifier

English | [中文](README.zh.md)

`dsh-as-a-verifier` is a standalone DeepSeek Harness function plugin that scores two agent trajectories with fine-grained token-logprob rewards and selects the best of N candidates with a Probabilistic Pivot Tournament (PPT). It provides both `ctx.verifier` and the model-facing `verifier_select` tool.

The MVP is a native TypeScript implementation. It derives the A–T logprob reward, prompt structure, A/B slot swapping, Bradley–Terry aggregation, and PPT policy from `llm-as-a-verifier` at commit `115de305f23ed89bc42e86e010853c40059f3f7d`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Install

This repository is Git-installable and intentionally has `private: true`; npm publication is not supported in the MVP.

```sh
dsh plugin --profile web add github:omdsh-dev/dsh-as-a-verifier
dsh plugin --profile headless add github:omdsh-dev/dsh-as-a-verifier
```

Pin a reviewed commit for reproducible installations:

```sh
dsh plugin --profile web add github:omdsh-dev/dsh-as-a-verifier#<commit>
```

Set `DEEPSEEK_API_KEY` in a Harness-supported credential source or launch environment. Missing credentials do not block plugin loading or the single-candidate fast path; the first operation that needs the API fails clearly.

## API

The function plugin exports `name`, `inject`, `Config`, and `apply` with no default export. It requires only `tools`; credentials and launch-environment services are optional.

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
```

`compare()` returns rewards in `[0, 1]`, per-criterion rewards, actual verifier calls, and token usage. `select()` returns `selectedIndex`, `best`, a complete index ranking, scores in candidate-index order, comparison and call counts, the validated criteria, and token usage. A one-candidate selection returns immediately without credentials or network traffic.

The `verifier_select` tool accepts the same problem, string candidates, and criteria. Its optional arguments are named `n_evaluations`, `pivots`, and `seed`; deployment ceilings always win over tool input. It uses a generic execution card and declares no file locations.

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

`compare()` uses `criteria × nEvaluations` calls. Cache hits reduce actual calls and current-operation usage to zero for those scores. Provider billing depends on the returned cached/uncached input, output, and reasoning token counts.

Missing score-position logprobs, no valid A–T alternatives, malformed JSON, invalid usage, and any partial scoring failure reject the whole operation. The plugin never fabricates a `0.5/0.5` tie. Only transport failures, HTTP 429, and HTTP 5xx are retried; authentication, protocol, and content failures are not. A valid `Retry-After` is honored within a bounded delay. Fiber disposal stops admission, aborts active requests, and waits for them to settle.

## Cache and data disclosure

Cache identity covers the prompt/schema version, backend, model, problem, ordered candidates, complete criterion, repetition, and slot order, then hashes that identity with SHA-256. Versioned entries are atomically replaced with owner-only permissions. Corrupt or incompatible entries are misses.

Cache files contain only numeric rewards and token usage. They do not store the raw task, trajectories, prompts, model responses, API keys, or reasoning traces. API calls necessarily send the problem, the two compared candidates, and one criterion to the configured DeepSeek endpoint. Credentials are resolved immediately before every HTTP request and never enter configuration, logs, cache entries, or test snapshots.

## Development

```sh
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
pnpm run prepare
```

The optional real-provider e2e is intentionally outside keyless CI and should self-skip when `DEEPSEEK_API_KEY` is absent.

## MVP boundaries

The MVP does not include online progress tracking, `verified_ralph`, multimodal inputs, Vertex/OpenAI-compatible backends, a Web panel, coding worktrees, price conversion, or a transparent model proxy. `verified_ralph` is the planned first consumer for the next phase.

## License

[MIT](LICENSE). The upstream attribution and complete upstream MIT notice are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
