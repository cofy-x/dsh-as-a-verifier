# dsh-as-a-verifier Contributor Notes

This repository is a standalone DeepSeek Harness plugin for fine-grained logprob verification and probabilistic candidate selection.

- Preserve the function-plugin named exports: `name`, `inject`, `Config`, and `apply`; do not add a default export.
- Keep Loader metadata in `src/index.ts`, schema/defaults in `src/config.ts`, host boundaries and activation in `src/runtime.ts`, scoring in `src/reward/`, and tournament policy in `src/tournament/`.
- Keep all registrations and in-flight requests scoped to the plugin fiber and test quiescent disposal.
- Resolve credential references for every provider request; never store or log secret values.
- Keep host APIs as peer dependencies and all source, configuration, tests, and documentation below this repository root.
- Update README files, public JSDoc, tests, and `cordis.patch.yml` together when behavior changes.
- Run `pnpm run verify:self-contained`, `pnpm run typecheck`, `pnpm test`, `pnpm run prepare`, and `pnpm run build` before delivery.
