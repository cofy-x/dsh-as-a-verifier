# Source Layout

- `src/index.ts`: Loader-facing namespace and public exports.
- `src/config.ts`: serializable configuration and defaults.
- `src/runtime.ts`: host boundaries, activation, and lifecycle ownership.
- `src/reward/`: fine-grained prompt, logprob extraction, and aggregation.
- `src/progress/`: strict offline/online checkpoint prompt and A–T decoder.
- `src/tournament/`: seeded ring and Probabilistic Pivot Tournament policy.
- `src/backend/`: DeepSeek wire client and response validation.
- `src/cache/`: separate content-addressed pairwise and progress caches.
- `src/tools.ts`: model-facing `verifier_select` and `verifier_track` consumers.
