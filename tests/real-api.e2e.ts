import { describe, expect, it } from 'vitest'
import { DeepSeekBackend } from '../src/backend/deepseek.ts'
import { resolveConfig } from '../src/config.ts'
import { buildPairwisePrompt } from '../src/reward/prompt.ts'
import { extractExpectedScore } from '../src/reward/score.ts'
import { buildProgressPrompt } from '../src/progress/prompt.ts'
import { extractProgressScores } from '../src/progress/score.ts'

const apiKey = process.env.DEEPSEEK_API_KEY?.trim()

describe('official DeepSeek API', () => {
  it.skipIf(apiKey === undefined || apiKey.length === 0)('returns usable score-position logprobs', async () => {
    const config = resolveConfig({ retryAttempts: 1, cacheEnabled: false }, {
      get: name => name === 'DEEPSEEK_BASE_URL' && process.env.DEEPSEEK_BASE_URL !== undefined
        ? { value: process.env.DEEPSEEK_BASE_URL }
        : undefined,
    })
    const backend = new DeepSeekBackend({ config, resolveApiKey: async () => apiKey })
    const response = await backend.score({
      prompt: buildPairwisePrompt(
        'Return the number one.',
        'Answered 1.',
        'Answered 2.',
        { id: 'correct', name: 'Correctness', description: 'Whether the answer is exactly 1.' },
      ),
    })
    expect(extractExpectedScore(response.distribution, '<score_A>')).toBeGreaterThanOrEqual(0)
    expect(extractExpectedScore(response.distribution, '<score_B>')).toBeLessThanOrEqual(1)
    expect(response.usage.calls).toBe(1)
  })

  it.skipIf(apiKey === undefined || apiKey.length === 0)('returns usable progress checkpoint logprobs', async () => {
    const config = resolveConfig({ retryAttempts: 1, cacheEnabled: false }, {
      get: name => name === 'DEEPSEEK_BASE_URL' && process.env.DEEPSEEK_BASE_URL !== undefined
        ? { value: process.env.DEEPSEEK_BASE_URL }
        : undefined,
    })
    const backend = new DeepSeekBackend({ config, resolveApiKey: async () => apiKey })
    const response = await backend.score({
      prompt: buildProgressPrompt('Return the number one.', ['Inspected the task.', 'Returned 1 and verified it.'], [1, 2]),
    })
    const scores = extractProgressScores(response.distribution, 2)
    expect(scores).toHaveLength(2)
    expect(scores.every(score => score >= 0 && score <= 1)).toBe(true)
  })
})
