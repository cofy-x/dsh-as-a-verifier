/** Serializable configuration for dsh-as-a-verifier. @module dsh-as-a-verifier/config */

import { join } from 'node:path'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Deployment configuration for the DeepSeek verifier backend and selection policy. */
export interface Config {
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
  readonly maxConcurrency?: number
  readonly requestTimeoutMs?: number
  readonly retryAttempts?: number
  readonly cacheEnabled?: boolean
  readonly dataDir?: string
}

/** Fully validated configuration consumed by the runtime. */
export interface ResolvedConfig {
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
  readonly maxConcurrency: number
  readonly requestTimeoutMs: number
  readonly retryAttempts: number
  readonly cacheEnabled: boolean
  readonly dataDir: string
}

/** Loader-visible configuration schema. Cross-field ceilings are checked by {@link resolveConfig}. */
export const Config = z.object({
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
  maxConcurrency: z.natural().default(8),
  requestTimeoutMs: z.natural().default(120_000),
  retryAttempts: z.natural().default(3),
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
  let baseURL = nonBlank(configuredBase, 'baseURL')
  while (baseURL.endsWith('/')) baseURL = baseURL.slice(0, -1)
  let parsed: URL
  try {
    parsed = new URL(baseURL)
  } catch {
    throw new Error('dsh-as-a-verifier: baseURL must be an absolute HTTP(S) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('dsh-as-a-verifier: baseURL must use HTTP or HTTPS')
  }
  return {
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
    maxConcurrency: positiveSafe(config.maxConcurrency ?? 8, 'maxConcurrency'),
    requestTimeoutMs,
    retryAttempts: positiveSafe(config.retryAttempts ?? 3, 'retryAttempts'),
    cacheEnabled: config.cacheEnabled ?? true,
    dataDir: config.dataDir === undefined
      ? join(resolveDshHome(), 'as-a-verifier')
      : nonBlank(config.dataDir, 'dataDir'),
  }
}
