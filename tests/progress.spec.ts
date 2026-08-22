import { describe, expect, it } from 'vitest'
import { extractProgressScores } from '../src/progress/score.ts'
import type { TokenDistribution } from '../src/reward/score.ts'
import { progressDistribution } from './helpers.ts'

describe('progress score extraction', () => {
  it('maps A to zero, T to one, and decodes fused tag-answer tokens', () => {
    expect(extractProgressScores(progressDistribution(['A', 'T']), 2)).toEqual([0, 1])
  })

  it('computes a normalized expectation over valid alternatives', () => {
    const distribution = progressDistribution(['A'])
    const positions = distribution.positionLogprobs.map(row => [...row])
    positions[2] = [{ token: '>A', logprob: Math.log(0.25) }, { token: '>T', logprob: Math.log(0.75) }]
    expect(extractProgressScores({ tokens: distribution.tokens, positionLogprobs: positions }, 1)[0]).toBeCloseTo(0.75)
  })

  it('rejects missing tags, invalid alternatives, and mismatched wire data', () => {
    expect(() => extractProgressScores(progressDistribution(['A']), 2)).toThrow('omitted')
    const invalid = progressDistribution(['A'])
    const positions = invalid.positionLogprobs.map(row => [...row])
    positions[2] = [{ token: '>Z', logprob: 0 }]
    expect(() => extractProgressScores({ tokens: invalid.tokens, positionLogprobs: positions }, 1)).toThrow('no valid A-T')
    const mismatch: TokenDistribution = { tokens: ['<c1>', '>A'], positionLogprobs: [[]] }
    expect(() => extractProgressScores(mismatch, 1)).toThrow('counts differ')
  })
})
