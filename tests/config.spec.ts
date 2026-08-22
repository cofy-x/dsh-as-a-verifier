import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'

describe('configuration', () => {
  it('resolves the documented defaults and endpoint environment override', () => {
    const resolved = resolveConfig({}, { get: name => name === 'DEEPSEEK_BASE_URL' ? { value: 'https://example.test/' } : undefined })
    expect(resolved).toMatchObject({
      model: 'deepseek-v4-flash', baseURL: 'https://example.test', apiKeyEnv: 'DEEPSEEK_API_KEY',
      reasoningEffort: 'high', maxTokens: 32_768, nEvaluations: 2, maxEvaluations: 8,
      pivots: 2, maxPivots: 8, maxCandidates: 16, maxCriteria: 8,
      maxProgressSteps: 256, maxProgressCheckpoints: 64,
      maxProgressStepChars: 32_768, maxProgressTrajectoryChars: 262_144,
      maxConcurrency: 8, requestTimeoutMs: 120_000, retryAttempts: 3, cacheEnabled: true,
    })
    expect(resolved.dataDir.endsWith('as-a-verifier')).toBe(true)
  })

  it('fails self-contained invalid configuration at load time', () => {
    expect(() => resolveConfig({ baseURL: 'file:relative' })).toThrow(/HTTP or HTTPS/)
    expect(() => resolveConfig({ nEvaluations: 9, maxEvaluations: 8 })).toThrow(/must not exceed/)
    expect(() => resolveConfig({ pivots: 9, maxPivots: 8 })).toThrow(/must not exceed/)
    expect(() => resolveConfig({ maxConcurrency: 0 })).toThrow(/positive safe integer/)
  })
})
