# Experimental Jev progress evaluation

Status: opt-in experiment. The default remains `progressEvaluatorMode: existing`; Jev is not an Auto review gate and must not be treated as production-calibrated.

## Why and where it fits

This experiment tests whether TypeSafe Jev can provide a lower-latency, lower-cost, stable semantic completion judgment for DSH agent trajectories. It does not replace the DeepSeek token-logprob implementation.

The plugin now has an internal `ProgressEvaluator` boundary. The existing A–T progress implementation remains the default public `track()` behavior, while Jev implements a typed binary completion evaluation through TypeSafe System One. A reserved `PairwiseEvaluator` shape documents the future A/B/tie extension point; `compare()` and `select()` still use the existing DeepSeek/logprob path.

Jev phase one evaluates only the final checkpoint. Its state contains the immutable objective and all steps observed up to that checkpoint. It receives no later checkpoint or hidden final answer. Online trackers are safe because each update contains only the prefix observed at that time. Jev returns a Noul probability and no explanation; DSH callers remain responsible for fixed correction guidance.

## Modes and configuration

```yaml
- id: dsh-as-a-verifier
  name: dsh-as-a-verifier
  config:
    progressEvaluatorMode: jev-shadow
    jevModel: jev-1.13.0
    jevCompletionThreshold: 0.95
```

- `existing` (default): only the current DeepSeek A–T evaluator runs. Results and failure behavior are unchanged, and `evaluation` is omitted.
- `jev-shadow`: the existing evaluator remains authoritative. Jev runs when the effective checkpoint set includes the final step; callers with more than two steps should explicitly pass `[steps.length]` because the existing evaluator's historical default is the internal range `2..T-1`. Its probability, decision, disagreement, latency, usage, cache status, or sanitized error code appears under `result.evaluation.shadow`. A Jev failure does not fail or alter the existing result; caller cancellation still cancels the operation.
- `jev`: explicit opt-in. An omitted checkpoint defaults to the final step; an explicit request must contain exactly that final step. A Jev failure is a structured `VerifierError`; there is no silent fallback.

| Setting | Experimental default | Purpose |
| --- | --- | --- |
| `jevModel` | `jev-1.13.0` | Exact, immutable model ID; floating aliases are rejected |
| `jevBaseURL` | `TYPESAFE_BASE_URL`, else `https://api.typesafe.ai` | TypeSafe API origin |
| `jevApiKeyEnv` | `TYPESAFE_API_KEY` | Credential reference, not a secret value |
| `jevCompletionThreshold` | `0.95` | Conservative experimental completion decision threshold |
| `jevShadowExistingThreshold` | `0.85` | Separately interprets the existing score only for shadow disagreement |
| `jevTimeoutMs` | `10000` | Per-request timeout |
| `jevRetryAttempts` | `1` | Total bounded SDK attempts |
| `jevMaxConcurrency` | `4` | Jev request concurrency ceiling |

The `0.95` Jev threshold is not equivalent to the existing `0.85` progress score. Both values are provisional. Raw probability, threshold, and final decision are retained separately so a labeled dataset can calibrate precision, recall, false positives, and false negatives. False completion is the primary safety risk.

The plugin reports the Jev threshold decision in `evaluation.completed`; it does
not rewrite a consumer's stopping policy. Existing consumers that compare
`result.final` against their own threshold must remain in `existing` or
`jev-shadow` until that policy has been explicitly calibrated for Jev. Enabling
`jev` alone does not apply `jevCompletionThreshold` inside Verified Ralph.

Set `TYPESAFE_API_KEY` through a DSH credential provider or launch environment. It is resolved immediately before each request and is not written to configuration, logs, caches, or test snapshots. Jev receives the objective and the observed trajectory, so do not enable it for data that cannot be sent to the configured TypeSafe endpoint.

## Runtime and safety boundary

The dependency and model are pinned to `@typesafe-ai/sdk@0.6.0` and `jev-1.13.0`. Jev modes require Node.js 24 or newer. The default `existing` mode retains the package's Node 22.19 compatibility. This gate exists because an open SDK issue reports that caught abort/cancellation can terminate Node 20/22 processes; the reported Node 24 path is unaffected. Remove the gate only after testing a fixed SDK release under the package's supported Node matrix.

Requests and responses are validated locally despite SDK types. The plugin rejects a mismatched response model, missing or out-of-range Noul probability, and invalid usage. It supplies a bounded timeout, cancellation signal, retries, and concurrency. Diagnostics expose stable codes without keys or task content.

Queued requests support cancellation before admission. Cancellation is rechecked
after credential resolution and SDK initialization; raw SDK errors are not chained
into public errors because they can retain headers and response bodies. The test
suite exercises the real SDK against a loopback server with a partial response
body in an isolated Node 24 process, for both timeout and user cancellation.
This is keyless transport evidence, not a claim about production availability.

Jev raw-response cache identity includes evaluator/schema version, provider, exact model, objective, observed result, and repeat. The raw probability cache intentionally excludes the threshold; threshold changes recompute the decision without repeating the paid model call. Cache files contain only probability, model, and usage. Existing and Jev cache namespaces cannot collide.

Current limitations:

- Jev is text-only. It does not inspect files, images, or the workspace except through trajectory text.
- The model documentation says CJK accuracy is lower than English; Chinese must be calibrated separately.
- The model accepts a 64k-token request, with state plus the longest question limited to 32k tokens. The plugin's character limits are not a guarantee that every Unicode input fits those token limits.
- Adversarial or prompt-injected trajectory text can bias semantic judgment. The evaluator is not a security boundary.
- Noul supplies a probability without an explanation. It cannot diagnose a failure or author corrective guidance.
- Only final-checkpoint completion is implemented for offline Jev evaluation. Pairwise Jev and multi-checkpoint Jev curves are out of scope.

## Local benchmark

The committed fixture is synthetic input only and contains no fabricated model scores. These commands require a built checkout:

```sh
pnpm run prepare
node scripts/jev-benchmark.mjs dry-run --input benchmarks/fixtures/jev-synthetic.jsonl
```

`dry-run` only validates local JSONL and makes no network call. It writes nothing.

For a real, explicitly authorized comparison, use a local, labeled, sanitized JSONL file with `id`, `problem`, non-empty `steps`, boolean `label`, and optional `language`/`outcome`. The command requires Node 24+, `DEEPSEEK_API_KEY`, and `TYPESAFE_API_KEY`; it makes billable calls to both providers. The output path is local and should remain untracked:

```sh
JEV_DATASET=path/to/sanitized-cases.jsonl
JEV_RESULTS=benchmark-results/jev-results.jsonl
node scripts/jev-benchmark.mjs run \
  --input "$JEV_DATASET" \
  --output "$JEV_RESULTS" \
  --existing-threshold 0.85 \
  --jev-threshold 0.95
```

The result file omits raw objectives and steps, uses owner-only permissions, and contains labels, dimensions, scores/decisions, latency, errors, and token usage. The SDK does not return monetary cost; estimate cost only from recorded tokens and pricing verified at evaluation time. Summarize a result file without network access:

```sh
node scripts/jev-benchmark.mjs summarize --input "$JEV_RESULTS"
```

Each new run reserves a fresh output file before paid requests, refuses overwrite,
and flushes completed rows incrementally. It records SDK/model versions, Node,
Git HEAD/dirty state, hashes of the built module and dataset, schema, and decision
thresholds. These identify an experiment; a dirty working tree also requires its
local patch for full reproduction. SDK failures without returned usage have
unknown billable usage, not necessarily zero cost.

For calibration datasets add `split: "calibration"` to each row. Keep related
task prefixes in the same split. Freeze thresholds before evaluating independent
`split: "test"` cases. Offline replay recomputes decisions without model calls:

```sh
node scripts/jev-benchmark.mjs replay --input "$JEV_RESULTS" --jev-threshold 0.95
```

Replay includes only explicitly marked calibration rows and refuses a test split.
Do not choose a production threshold from the four synthetic fixtures. Their
positive labels describe intended completion, but narration alone is inadequate
evidence for the strict prompt; use manually labeled real tool output for calibration.

Latency metrics include errors/timeouts. Classification metrics exclude errors
and must be read together with evaluated counts and error rate. Shadow metadata
retains usage from successful repeats even when a different repeat fails;
unobserved usage is not inferred. Online tracker metadata describes the latest
update, while its top-level usage is cumulative authoritative usage.

Output includes accuracy, precision/recall, false-positive/false-negative rates, disagreement, p50/p95 latency, error rate, and available language/outcome groups. Never commit sensitive datasets or outputs.

## Promotion criteria

Do not promote Jev from shadow or use it as an automatic blocking gate until all of the following are evidenced:

- representative, labeled DSH data has been used for threshold calibration;
- false-positive rate is no worse than the existing verifier or meets an explicit team bound;
- shadow disagreements have been sampled and reviewed by humans;
- p95 latency and error rate meet stated targets;
- Chinese tasks pass a separate evaluation;
- SDK cancellation and Node stability are verified on the supported matrix;
- any automated gate has a fallback or human-review path.

## Sources

Accessed 2026-09-22:

- TypeSafe introduction: <https://docs.typesafe.ai/introduction>
- System One concepts: <https://docs.typesafe.ai/concepts/system-one>
- TypeSafe JavaScript SDK: <https://docs.typesafe.ai/sdk/javascript>
- TypeSafe API reference: <https://docs.typesafe.ai/api>
- TypeSafe models and aliases: <https://docs.typesafe.ai/models>
- Jev 1.13 model card: <https://docs.typesafe.ai/model-jaggedness/jev-1.13>
- TypeSafe SDK v0.6.0 source and release: <https://github.com/typesafe-ai/typesafe-sdk-js/releases/tag/v0.6.0>
- SDK cancellation issue #2: <https://github.com/typesafe-ai/typesafe-sdk-js/issues/2>
- SDK runtime validation issue #6: <https://github.com/typesafe-ai/typesafe-sdk-js/issues/6>
- TypeSafe legal and data terms: <https://docs.typesafe.ai/legal>
- LangChain, Jev agent evals in LangSmith: <https://www.langchain.com/blog/jev-agent-evals-langsmith>
