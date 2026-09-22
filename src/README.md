# Source Layout

- `src/index.ts`: Loader-facing namespace and public exports.
- `src/config.ts`: serializable configuration and defaults.
- `src/runtime.ts`: host boundaries, activation, and lifecycle ownership.
- `src/reward/`: fine-grained prompt, logprob extraction, and aggregation.
- `src/progress/`: strict offline/online checkpoint prompt and A–T decoder.
- `src/evaluator/`: semantic evaluator seams and the opt-in Jev final-completion evaluator.
- `src/tournament/`: seeded ring and Probabilistic Pivot Tournament policy.
- `src/backend/`: DeepSeek wire client and response validation.
- `src/cache/`: separate content-addressed pairwise, progress, and raw Jev caches.
- `src/benchmark/`: pure metrics for the local Jev comparison runner.
- `src/tools.ts`: model-facing `verifier_select` and `verifier_track` consumers.
