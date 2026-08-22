# dsh-as-a-verifier

English | [中文](README.zh.md)

`dsh-as-a-verifier` is a standalone DeepSeek Harness plugin for fine-grained logprob verification and probabilistic candidate selection.

The initial scaffold reserves the `ctx.verifier` service and `verifier_select` tool contract. Product behavior is implemented on the feature branch after the self-contained repository skeleton is proven.

## Development

```sh
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
pnpm run prepare
```

## License

[MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream attribution.
