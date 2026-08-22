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
export { VerifierService } from './service.ts'
export { VerifierError } from './types.ts'
export type {
  VerifierCandidateScore,
  VerifierCompareRequest,
  VerifierCompareResult,
  VerifierCriterion,
  VerifierCriterionScore,
  VerifierSelectRequest,
  VerifierSelectResult,
  VerifierServiceApi,
  VerifierUsage,
} from './types.ts'
export { apply } from './runtime.ts'
