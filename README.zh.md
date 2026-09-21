# dsh-as-a-verifier

[English](README.md) | 中文

`dsh-as-a-verifier` 是独立的 DeepSeek Harness function plugin：比较两条 Agent 轨迹、通过 Probabilistic Pivot Tournament（PPT）从 N 个候选中选优，并评分单条轨迹的执行进展。插件提供 `ctx.verifier` 与模型工具 `verifier_select`、`verifier_track`。

TypeScript 原生实现的 pairwise reward、PPT 与离线/在线 A–T progress tracking 源自 llm-as-a-verifier（<https://github.com/llm-as-a-verifier/llm-as-a-verifier>）的 commit `8db8a114355a9d7fdf9a8d1d5c87f6aeebd18770`。完整归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 安装

仓库支持 Git URL 安装，`package.json` 有意保持 `private: true`；不发布到 npm。

```sh
dsh plugin --profile web add github:cofy-x/dsh-as-a-verifier
dsh plugin --profile headless add github:cofy-x/dsh-as-a-verifier
```

默认分支安装只在安装时解析一次，随后由 Profile lockfile 固定。升级需要显式执行，再重启 Profile：

```sh
dsh plugin --profile web update dsh-as-a-verifier
```

Git 安装会执行本包的自包含 `prepare` 构建。将 pnpm 报告的精确键加入 `$DSH_HOME/profiles/<profile>/pnpm-workspace.yaml`，然后重试：

```yaml
allowBuilds:
  dsh-as-a-verifier@https://codeload.github.com/cofy-x/dsh-as-a-verifier/tar.gz/<resolved-commit>: true
```

请使用 pnpm 输出的精确键。内容寻址键只授权该次解析出的 Git 归档；这里有意不使用包名级的宽泛授权。

需要稳定复现的部署应从 <https://github.com/cofy-x/dsh-as-a-verifier/releases> 选择不可移动的 tag（或使用审核过的 commit）：

```sh
VERIFIER_TAG=vX.Y.Z
dsh plugin --profile web add "github:cofy-x/dsh-as-a-verifier#$VERIFIER_TAG"
```

安装后，`dsh --profile web --dump-config`（或对应的 Headless profile）应只出现一行 `dsh-as-a-verifier`。

请在 Harness 支持的凭据源或启动环境中设置 `DEEPSEEK_API_KEY`。缺少凭据不会阻止插件加载或单候选短路；首次真正需要 API 的操作会明确失败。

## API

插件导出 `name`、`inject`、`Config` 和 `apply`，没有 default export。只强制依赖 `tools`；credentials 与 launch-environment 均为可选服务。consumer 可通过 `ctx.verifier.protocolVersion` 在工作开始前拒绝不兼容 provider，并通过 `ctx.verifier.capabilities` 检查所需能力。

```ts
const comparison = await ctx.verifier.compare({
  problem: '修复解析器失败测试。',
  traceA: '候选 A 的执行轨迹',
  traceB: '候选 B 的执行轨迹',
  criteria: [{
    id: 'correctness',
    name: '正确性',
    description: '优先选择修复完整且有通过测试证据的轨迹。',
  }],
})

const selection = await ctx.verifier.select({
  problem: '修复解析器失败测试。',
  candidates: ['轨迹 0', '轨迹 1', '轨迹 2'],
  criteria: [{
    id: 'correctness',
    name: '正确性',
    description: '优先选择修复完整且有通过测试证据的轨迹。',
  }],
  nEvaluations: 2,
  pivots: 2,
  seed: 0,
})

const progress = await ctx.verifier.track({
  problem: '修复解析器失败测试。',
  steps: ['复现失败。', '修改解析器。', '运行测试并通过。'],
  checkpointSteps: [1, 3],
})

const tracker = ctx.verifier.createProgressTracker({ problem: '修复解析器失败测试。' })
await tracker.update('检查并复现失败。')
await tracker.update('实现修复并运行定向测试。')
const onlineProgress = tracker.result()
await tracker.dispose()
```

`compare()` 返回 `[0,1]` reward、逐 criterion reward、真实 verifier 调用数和 token usage。`select()` 返回 `selectedIndex`、`best`、完整索引 ranking、按候选索引排列的分数、comparison/call 数、校验后的 criteria 与 token usage。单候选会直接返回，不读取凭据、不访问网络。

`track()` 返回 checkpoint 分数、逐 evaluation 原始曲线、最终分数、调用数和 usage。超过两个 step 时默认评分 `2..T-1`，更短轨迹评分全部 step；checkpoint 使用 1-based、唯一且严格递增的编号。`createProgressTracker()` 每次只评分当时可见的完整 prefix，未来步骤不会影响过去分数。

`verifier_select` 接受同样的 problem、字符串 candidates 和 criteria，可选参数为 `n_evaluations`、`pivots`、`seed`；`verifier_track` 接受 `problem`、`steps`、可选 `checkpoint_steps` 与 `n_evaluations`。部署上限始终优先，两个工具都使用 generic card 且不声明文件位置。

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `model` | `deepseek-v4-flash` | DeepSeek verifier 模型 |
| `baseURL` | `DEEPSEEK_BASE_URL`，否则 `https://api.deepseek.com` | API origin，自动追加 chat-completions 路径 |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 凭据引用，不是密钥值 |
| `reasoningEffort` | `high` | `off`、`low`、`high` 或 `max` |
| `maxTokens` | `32768` | 最大 completion token |
| `nEvaluations` / `maxEvaluations` | `2` / `8` | 重复评分默认值与部署上限 |
| `pivots` / `maxPivots` | `2` / `8` | PPT pivot 默认值与部署上限 |
| `maxCandidates` | `16` | 候选上限 |
| `maxCriteria` | `8` | criterion 上限 |
| `maxProgressSteps` | `256` | progress 轨迹 step 上限 |
| `maxProgressCheckpoints` | `64` | 单次请求 checkpoint 上限 |
| `maxProgressStepChars` | `32768` | 单个 step 字符上限 |
| `maxProgressTrajectoryChars` | `262144` | progress 轨迹总字符上限 |
| `maxConcurrency` | `8` | 最大并行 HTTP 调用数 |
| `requestTimeoutMs` | `120000` | 每次 HTTP attempt 超时 |
| `retryAttempts` | `3` | 可重试错误的总 attempt 数 |
| `cacheEnabled` | `true` | 启用持久化数值评分缓存 |
| `dataDir` | `$DSH_HOME/as-a-verifier` | 插件数据目录 |

非法 URL、非正数上限、默认值超过 ceiling 等自包含错误在加载时失败。空输入、重复 criterion id、请求参数超过部署上限会在访问网络前失败。

## 评分、成本与失败语义

每个 criterion 要求 verifier 分别输出 A–T。reward 是精确 score position 上所有有效 top-logprob alternative 的归一化期望，不是解析整数，也不是采用一次采样字母。奇数次重复会交换 A/B prompt 槽位以降低位置偏差。criterion 位于 prompt 尾部；每个共享轨迹 prefix 先完成第一个 criterion 的 warm-up，再在 `maxConcurrency` 下展开其余请求。

当 `N > 1` 且 `k = min(pivots, N)`：

```text
comparisons = N + k(N - k) + k(k - 1) / 2
verifier calls = comparisons × criteria × nEvaluations
```

`compare()` 的调用数是 `criteria × nEvaluations`。离线 progress 无论 checkpoint 数量多少都只使用 `nEvaluations` 次调用；在线 tracker 每次 update 使用 `nEvaluations` 次调用。缓存命中不会增加本次运行的实际调用数或 token usage。

缺少 score-position logprobs、没有有效 A–T alternative、JSON 畸形、usage 非法或部分评分失败都会让整个操作失败。插件绝不伪造 `0.5/0.5` 平局或 `0.5` progress，也不会从采样文本回退解析 progress。只有传输错误、HTTP 429 和 HTTP 5xx 会重试；认证、协议和内容错误不重试。合法 `Retry-After` 会在有界延迟内被尊重。fiber dispose 会停止接收新操作、中止活跃请求并等待其收敛。

## 缓存与数据外发

Pairwise 与 progress 使用独立版本化缓存。Progress identity 包含 backend、model、prompt version、problem、完整 steps、checkpoints 和 repeat；pairwise 保留原有 identity。全部 identity 在写入文件系统前使用 SHA-256。损坏或版本不匹配一律按 miss 处理。

缓存文件只保存数值 reward 和 token usage，不保存原始任务、候选轨迹、prompt、模型响应、API key 或 reasoning trace。API 调用会发送 problem 与相关轨迹：pairwise 是两个候选和一个 criterion，progress 是全部 steps 与 checkpoints。凭据在每次 HTTP 请求前重新解析，从不进入配置、日志、缓存或测试快照。

## 开发

```sh
corepack enable pnpm
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
pnpm run prepare
```

已审核的 DSH/Node/pnpm 基线记录在 [docs/dsh-compatibility.md](docs/dsh-compatibility.md)。CI 在 Linux、Windows 上运行 keyless suite，从 PR 的精确 commit 验证安装（包括 fork PR），并启动干净的 Web 与 Headless Profile。`ci / required` 是合并门禁。

发布保持人工、仅 Git：先用 `release-check` 验证精确 `main` SHA，再创建不可移动的 annotated tag；tag 检查通过后发布非 draft 的 GitHub Release。真实 provider E2E 不进入 CI，并在 backend、prompt 或 decoder 行为变化时强制执行。

## 边界

本包不包含 `verified_ralph`、多模态、Vertex/OpenAI-compatible backend、Web 面板、coding worktree、价格换算或透明模型代理；`dsh-verified-ralph` 是独立 consumer 插件。

## 许可

[MIT](LICENSE)。上游归属和完整上游 MIT notice 位于 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
