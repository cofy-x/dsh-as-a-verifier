/** Fine-grained verification for DeepSeek Harness. @module dsh-as-a-verifier */

export const name = 'dsh-as-a-verifier'

/** Services required before this plugin applies. */
export const inject = ['tools']

export { Config } from './config.ts'
export { resolveConfig } from './config.ts'
export type { Config as PluginConfig, ResolvedConfig } from './config.ts'
export { DeepSeekBackend } from './backend/deepseek.ts'
export type { BackendScoreRequest, BackendScoreResponse, DeepSeekBackendOptions, VerifierBackend } from './backend/deepseek.ts'
export { ScoreCache, scoreCacheDigest } from './cache/score-cache.ts'
export { ProgressCache, progressCacheDigest } from './cache/progress-cache.ts'
export { JevProgressCache, jevProgressCacheDigest } from './cache/jev-progress-cache.ts'
export { assertJevRuntime, JEV_PROGRESS_SCHEMA_VERSION, JevProgressEvaluator } from './evaluator/jev.ts'
export type { JevClient, JevClientFactory } from './evaluator/jev.ts'
export type { PairwiseEvaluation, PairwiseEvaluationRequest, PairwiseEvaluator, ProgressEvaluation, ProgressEvaluationRequest, ProgressEvaluator } from './evaluator/progress.ts'
export { VerifierService } from './service.ts'
export { benchmarkMetrics, groupedBenchmarkMetrics } from './benchmark/metrics.ts'
export type { BenchmarkDecision, BenchmarkMetrics, BenchmarkResultRow } from './benchmark/metrics.ts'
export { VERIFIER_CAPABILITIES, VERIFIER_PROTOCOL_VERSION, VerifierError } from './types.ts'
export type {
  VerifierCapabilities,
  VerifierCandidateScore,
  VerifierCompareRequest,
  VerifierCompareResult,
  VerifierCriterion,
  VerifierCriterionScore,
  VerifierProgressTracker,
  VerifierProgressEvaluation,
  VerifierProgressShadowEvaluation,
  VerifierProgressTrackerOptions,
  VerifierSelectRequest,
  VerifierSelectResult,
  VerifierServiceApi,
  VerifierTrackRequest,
  VerifierTrackResult,
  VerifierUsage,
} from './types.ts'
export { apply } from './runtime.ts'
