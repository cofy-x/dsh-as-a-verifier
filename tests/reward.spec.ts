import { describe, expect, it } from 'vitest'
import { extractExpectedScore } from '../src/reward/score.ts'

describe('fine-grained A-T reward', () => {
  it('normalizes the probability expectation to [0, 1]', () => {
    const result = extractExpectedScore({
      tokens: ['<score_A>', ' A'],
      positionLogprobs: [
        [{ token: '<score_A>', logprob: 0 }],
        [{ token: ' A', logprob: Math.log(0.75) }, { token: ' T', logprob: Math.log(0.25) }],
      ],
    }, '<score_A>')
    expect(result).toBeCloseTo(0.75)
  })

  it('accepts a fused closing bracket and score token', () => {
    expect(extractExpectedScore({
      tokens: ['<score_A', '>A'],
      positionLogprobs: [
        [{ token: '<score_A', logprob: 0 }],
        [{ token: '>A', logprob: 0 }, { token: '>T', logprob: -10 }],
      ],
    }, '<score_A>')).toBeGreaterThan(0.99)
  })

  it('rejects missing positions and invalid alternatives', () => {
    expect(() => extractExpectedScore({ tokens: ['no score'], positionLogprobs: [[]] }, '<score_A>'))
      .toThrow(/did not expose logprobs/)
    expect(() => extractExpectedScore({
      tokens: ['<score_A>', ' ?'],
      positionLogprobs: [[{ token: '<score_A>', logprob: 0 }], [{ token: ' ?', logprob: 0 }]],
    }, '<score_A>')).toThrow(/no valid A-T alternatives/)
  })
})
