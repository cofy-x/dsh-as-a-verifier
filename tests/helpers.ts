import type { VerifierBackend } from '../src/backend/deepseek.ts'
import { resolve } from 'node:path'
import type { ResolvedConfig } from '../src/config.ts'
import type { TokenDistribution } from '../src/reward/score.ts'
import type { VerifierUsage } from '../src/types.ts'

export const zeroUsage: VerifierUsage = {
  calls: 1,
  inputTokens: 10,
  cachedInputTokens: 2,
  uncachedInputTokens: 8,
  outputTokens: 3,
  reasoningTokens: 1,
  cacheHitRate: 0.2,
}

export function resolvedConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    model: 'deepseek-v4-flash',
    baseURL: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY' as ResolvedConfig['apiKeyEnv'],
    reasoningEffort: 'high',
    maxTokens: 32_768,
    nEvaluations: 2,
    maxEvaluations: 8,
    pivots: 2,
    maxPivots: 8,
    maxCandidates: 16,
    maxCriteria: 8,
    maxProgressSteps: 256,
    maxProgressCheckpoints: 64,
    maxProgressStepChars: 32_768,
    maxProgressTrajectoryChars: 262_144,
    maxConcurrency: 8,
    requestTimeoutMs: 120_000,
    retryAttempts: 3,
    cacheEnabled: false,
    dataDir: resolve('test-data'),
    ...overrides,
  }
}

export function scoreDistribution(letterA: string, letterB: string): TokenDistribution {
  const tokens = ['analysis', '<score_A>', ` ${letterA}`, ' </score_A>\n', '<score_B>', ` ${letterB}`, ' </score_B>']
  return {
    tokens,
    positionLogprobs: tokens.map((token, index) => {
      if (index === 2) return [{ token: ` ${letterA}`, logprob: 0 }]
      if (index === 5) return [{ token: ` ${letterB}`, logprob: 0 }]
      return [{ token, logprob: 0 }]
    }),
  }
}

export function progressDistribution(letters: readonly string[]): TokenDistribution {
  const tokens: string[] = ['analysis\n']
  for (const [index, letter] of letters.entries()) tokens.push(`<c${index + 1}>`, `>${letter}`, `</c${index + 1}>\n`)
  return {
    tokens,
    positionLogprobs: tokens.map(token => token.startsWith('>')
      ? [{ token, logprob: 0 }]
      : [{ token, logprob: 0 }]),
  }
}

export class PromptBackend implements VerifierBackend {
  readonly id = 'fake-v1'
  readonly model = 'fake-model'
  calls = 0

  async score(request: { prompt: string, signal?: AbortSignal }) {
    this.calls += 1
    request.signal?.throwIfAborted()
    if (request.prompt.includes('The checkpoints are:')) {
      const count = [...request.prompt.matchAll(/Checkpoint \d+ =/gu)].length
      const letters = Array.from({ length: count }, (_, index) => index === count - 1 ? 'T' : 'K')
      return { distribution: progressDistribution(letters), usage: zeroUsage }
    }
    const markerA = '**Trajectory ' + 'A:**\n'
    const markerB = '**Trajectory ' + 'B:**\n'
    const markerScale = '**Rating Scale:**'
    const startA = request.prompt.indexOf(markerA) + markerA.length
    const startBMarker = request.prompt.indexOf(markerB)
    const startB = startBMarker + markerB.length
    const a = request.prompt.slice(startA, startBMarker).trim()
    const b = request.prompt.slice(startB, request.prompt.indexOf(markerScale)).trim()
    const grade = (value: string): string => value.includes('GOOD') ? 'A' : value.includes('MID') ? 'J' : 'T'
    return { distribution: scoreDistribution(grade(a), grade(b)), usage: zeroUsage }
  }
}
