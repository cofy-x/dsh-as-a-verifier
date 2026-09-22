/** Serializable configuration for dsh-as-a-verifier. @module dsh-as-a-verifier/config */

import { join } from 'node:path'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Deployment configuration for the DeepSeek verifier backend and selection policy. */
export interface Config {
  readonly progressEvaluatorMode?: 'existing' | 'jev-shadow' | 'jev'
  readonly model?: string
  readonly baseURL?: string
  readonly apiKeyEnv?: string
  readonly reasoningEffort?: 'off' | 'low' | 'high' | 'max'
  readonly maxTokens?: number
  readonly nEvaluations?: number
  readonly maxEvaluations?: number
  readonly pivots?: number
  readonly maxPivots?: number
  readonly maxCandidates?: number
  readonly maxCriteria?: number
  readonly maxProgressSteps?: number
  readonly maxProgressCheckpoints?: number
  readonly maxProgressStepChars?: number
  readonly maxProgressTrajectoryChars?: number
  readonly maxConcurrency?: number
  readonly requestTimeoutMs?: number
  readonly retryAttempts?: number
  readonly jevModel?: string
  readonly jevBaseURL?: string
  readonly jevApiKeyEnv?: string
  readonly jevCompletionThreshold?: number
  readonly jevShadowExistingThreshold?: number
  readonly jevTimeoutMs?: number
  readonly jevRetryAttempts?: number
  readonly jevMaxConcurrency?: number
  readonly cacheEnabled?: boolean
  readonly dataDir?: string
}

/** Fully validated configuration consumed by the runtime. */
export interface ResolvedConfig {
  readonly progressEvaluatorMode: 'existing' | 'jev-shadow' | 'jev'
  readonly model: string
  readonly baseURL: string
  readonly apiKeyEnv: CredentialRef
  readonly reasoningEffort: 'off' | 'low' | 'high' | 'max'
  readonly maxTokens: number
  readonly nEvaluations: number
  readonly maxEvaluations: number
  readonly pivots: number
  readonly maxPivots: number
  readonly maxCandidates: number
  readonly maxCriteria: number
  readonly maxProgressSteps: number
  readonly maxProgressCheckpoints: number
  readonly maxProgressStepChars: number
  readonly maxProgressTrajectoryChars: number
  readonly maxConcurrency: number
  readonly requestTimeoutMs: number
  readonly retryAttempts: number
  readonly jevModel: string
  readonly jevBaseURL: string
  readonly jevApiKeyEnv: CredentialRef
  readonly jevCompletionThreshold: number
  readonly jevShadowExistingThreshold: number
  readonly jevTimeoutMs: number
  readonly jevRetryAttempts: number
  readonly jevMaxConcurrency: number
  readonly cacheEnabled: boolean
  readonly dataDir: string
}

/** Loader-visible configuration schema. Cross-field ceilings are checked by {@link resolveConfig}. */
export const Config = z.object({
  progressEvaluatorMode: z.union([z.const('existing'), z.const('jev-shadow'), z.const('jev')]).default('existing'),
  model: z.string().default('deepseek-v4-flash'),
  baseURL: z.string(),
  apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
  reasoningEffort: z.union([z.const('off'), z.const('low'), z.const('high'), z.const('max')]).default('high'),
  maxTokens: z.natural().default(32_768),
  nEvaluations: z.natural().default(2),
  maxEvaluations: z.natural().default(8),
  pivots: z.natural().default(2),
  maxPivots: z.natural().default(8),
  maxCandidates: z.natural().default(16),
  maxCriteria: z.natural().default(8),
  maxProgressSteps: z.natural().default(256),
  maxProgressCheckpoints: z.natural().default(64),
  maxProgressStepChars: z.natural().default(32_768),
  maxProgressTrajectoryChars: z.natural().default(262_144),
  maxConcurrency: z.natural().default(8),
  requestTimeoutMs: z.natural().default(120_000),
  retryAttempts: z.natural().default(3),
  jevModel: z.string().default('jev-1.13.0'),
  jevBaseURL: z.string(),
  jevApiKeyEnv: z.string().default('TYPESAFE_API_KEY'),
  jevCompletionThreshold: z.number().default(0.95),
  jevShadowExistingThreshold: z.number().default(0.85),
  jevTimeoutMs: z.natural().default(10_000),
  jevRetryAttempts: z.natural().default(1),
  jevMaxConcurrency: z.natural().default(4),
  cacheEnabled: z.boolean().default(true),
  dataDir: z.string(),
}) as unknown as z<Config>

/** Environment view used while resolving the endpoint without exposing secret values. */
export interface ConfigEnvironment {
  get(name: string): { value: string } | undefined
}

function nonBlank(value: string, field: string): string {
  const resolved = value.trim()
  if (resolved.length === 0) throw new Error(`dsh-as-a-verifier: ${field} must be non-blank`)
  return resolved
}

function positiveSafe(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`dsh-as-a-verifier: ${field} must be a positive safe integer`)
  }
  return value
}

function probability(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`dsh-as-a-verifier: ${field} must be within 0..1`)
  }
  return value
}

function httpUrl(value: string, field: string): string {
  let resolved = nonBlank(value, field)
  while (resolved.endsWith('/')) resolved = resolved.slice(0, -1)
  let parsed: URL
  try { parsed = new URL(resolved) } catch {
    throw new Error(`dsh-as-a-verifier: ${field} must be an absolute HTTP(S) URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`dsh-as-a-verifier: ${field} must use HTTP or HTTPS`)
  }
  return resolved
}

/** Resolve defaults and reject configuration that cannot become valid at runtime. */
export function resolveConfig(config: Config, environment?: ConfigEnvironment): ResolvedConfig {
  const maxEvaluations = positiveSafe(config.maxEvaluations ?? 8, 'maxEvaluations')
  const nEvaluations = positiveSafe(config.nEvaluations ?? 2, 'nEvaluations')
  if (nEvaluations > maxEvaluations) {
    throw new Error('dsh-as-a-verifier: nEvaluations must not exceed maxEvaluations')
  }
  const maxPivots = positiveSafe(config.maxPivots ?? 8, 'maxPivots')
  const pivots = positiveSafe(config.pivots ?? 2, 'pivots')
  if (pivots > maxPivots) throw new Error('dsh-as-a-verifier: pivots must not exceed maxPivots')
  const requestTimeoutMs = positiveSafe(config.requestTimeoutMs ?? 120_000, 'requestTimeoutMs')
  if (requestTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`dsh-as-a-verifier: requestTimeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`)
  }
  const configuredBase = config.baseURL
    ?? environment?.get('DEEPSEEK_BASE_URL')?.value
    ?? 'https://api.deepseek.com'
  const baseURL = httpUrl(configuredBase, 'baseURL')
  const jevTimeoutMs = positiveSafe(config.jevTimeoutMs ?? 10_000, 'jevTimeoutMs')
  if (jevTimeoutMs > MAX_TIMER_DELAY_MS) throw new Error(`dsh-as-a-verifier: jevTimeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`)
  const jevModel = nonBlank(config.jevModel ?? 'jev-1.13.0', 'jevModel')
  if (!/^jev-\d+\.\d+\.\d+$/u.test(jevModel)) {
    throw new Error('dsh-as-a-verifier: jevModel must be an immutable versioned model ID such as jev-1.13.0')
  }
  return {
    progressEvaluatorMode: config.progressEvaluatorMode ?? 'existing',
    model: nonBlank(config.model ?? 'deepseek-v4-flash', 'model'),
    baseURL,
    apiKeyEnv: credentialRef(nonBlank(config.apiKeyEnv ?? 'DEEPSEEK_API_KEY', 'apiKeyEnv')),
    reasoningEffort: config.reasoningEffort ?? 'high',
    maxTokens: positiveSafe(config.maxTokens ?? 32_768, 'maxTokens'),
    nEvaluations,
    maxEvaluations,
    pivots,
    maxPivots,
    maxCandidates: positiveSafe(config.maxCandidates ?? 16, 'maxCandidates'),
    maxCriteria: positiveSafe(config.maxCriteria ?? 8, 'maxCriteria'),
    maxProgressSteps: positiveSafe(config.maxProgressSteps ?? 256, 'maxProgressSteps'),
    maxProgressCheckpoints: positiveSafe(config.maxProgressCheckpoints ?? 64, 'maxProgressCheckpoints'),
    maxProgressStepChars: positiveSafe(config.maxProgressStepChars ?? 32_768, 'maxProgressStepChars'),
    maxProgressTrajectoryChars: positiveSafe(config.maxProgressTrajectoryChars ?? 262_144, 'maxProgressTrajectoryChars'),
    maxConcurrency: positiveSafe(config.maxConcurrency ?? 8, 'maxConcurrency'),
    requestTimeoutMs,
    retryAttempts: positiveSafe(config.retryAttempts ?? 3, 'retryAttempts'),
    jevModel,
    jevBaseURL: httpUrl(config.jevBaseURL ?? environment?.get('TYPESAFE_BASE_URL')?.value ?? 'https://api.typesafe.ai', 'jevBaseURL'),
    jevApiKeyEnv: credentialRef(nonBlank(config.jevApiKeyEnv ?? 'TYPESAFE_API_KEY', 'jevApiKeyEnv')),
    jevCompletionThreshold: probability(config.jevCompletionThreshold ?? 0.95, 'jevCompletionThreshold'),
    jevShadowExistingThreshold: probability(config.jevShadowExistingThreshold ?? 0.85, 'jevShadowExistingThreshold'),
    jevTimeoutMs,
    jevRetryAttempts: positiveSafe(config.jevRetryAttempts ?? 1, 'jevRetryAttempts'),
    jevMaxConcurrency: positiveSafe(config.jevMaxConcurrency ?? 4, 'jevMaxConcurrency'),
    cacheEnabled: config.cacheEnabled ?? true,
    dataDir: config.dataDir === undefined
      ? join(resolveDshHome(), 'as-a-verifier')
      : nonBlank(config.dataDir, 'dataDir'),
  }
}
