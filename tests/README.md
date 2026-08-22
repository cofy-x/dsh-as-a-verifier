# Tests

The evidence map is:

- `reward.spec.ts`: A–T expectation, fused tokens, and strict missing-logprob failures.
- `progress.spec.ts`: progress A–T direction, expectations, fused tokens, and strict failures.
- `tournament.spec.ts`: seeded graph determinism, PPT budget, and tie-breaks.
- `backend.spec.ts`: request wire fields, usage, credential rotation, retry, timeout, cancellation, malformed responses, and secret-safe diagnostics.
- `cache.spec.ts`: pairwise/progress identity invalidation, numeric-only entries, and corrupt-entry misses.
- `service.spec.ts`: compare/select/track, online prefix isolation, tracker lifecycle, cache hits, and limits.
- `plugin.spec.ts`: real Cordis mount, Loader exports, canonical tool snapshot, disposal, and in-flight abort quiescence.
- `composition.spec.ts`: real Loader/Include boot of Web and Headless profile fixtures using the bundle row.
- `real-api.e2e.ts`: optional official DeepSeek endpoint logprob check; it self-skips without `DEEPSEEK_API_KEY` and runs only through `pnpm test:e2e`.

Stable model-visible output lives under `tests/snapshots/`. Built ESM imports and Git-install smoke are release-stage commands, not Vitest substitutes.
