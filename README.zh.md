# dsh-as-a-verifier

[English](README.md) | 中文

`dsh-as-a-verifier` 是一个独立的 DeepSeek Harness 插件，用于细粒度 logprob 验证与概率化候选选优。

初始脚手架预留 `ctx.verifier` 服务与 `verifier_select` 工具合同。自包含仓库骨架验证通过后，产品行为在功能分支实现。

## 开发

```sh
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
pnpm run prepare
```

## 许可

[MIT](LICENSE)。上游归属信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
