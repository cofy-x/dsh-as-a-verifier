/**
 * Fine-grained score-token expectation derived from llm-as-a-verifier at
 * commit 115de305f23ed89bc42e86e010853c40059f3f7d (MIT).
 * @module dsh-as-a-verifier/reward/score
 */

import { VerifierError } from '../types.ts'

export const SCORE_GRANULARITY = 20

/** Token alternatives available at one generated position. */
export interface TokenAlternative {
  readonly token: string
  readonly logprob: number
}

/** Provider-neutral generated tokens and top alternatives at every position. */
export interface TokenDistribution {
  readonly tokens: readonly string[]
  readonly positionLogprobs: readonly (readonly TokenAlternative[])[]
}

const SCORE_VALUE = new Map<string, number>(
  Array.from({ length: SCORE_GRANULARITY }, (_, index) => {
    const upper = String.fromCharCode(65 + index)
    return [[upper, SCORE_GRANULARITY - index], [upper.toLowerCase(), SCORE_GRANULARITY - index]] as const
  }).flat(),
)

function alternativesAfterTag(distribution: TokenDistribution, tag: string): readonly TokenAlternative[] | undefined {
  if (distribution.tokens.length !== distribution.positionLogprobs.length) {
    throw new VerifierError('verifier token and logprob position counts differ', 'INVALID_LOGPROBS')
  }
  for (const suffix of [tag, tag.slice(0, -1)]) {
    let found: readonly TokenAlternative[] | undefined
    let generated = ''
    for (let index = 0; index < distribution.tokens.length; index += 1) {
      generated += distribution.tokens[index]
      if (generated.trimEnd().endsWith(suffix)) found = distribution.positionLogprobs[index + 1]
    }
    if (found !== undefined) return found
  }
  return undefined
}

/** Return the normalized expectation over valid A–T alternatives after `tag`. */
export function extractExpectedScore(distribution: TokenDistribution, tag: string): number {
  const alternatives = alternativesAfterTag(distribution, tag)
  if (alternatives === undefined) {
    throw new VerifierError(`verifier response did not expose logprobs after ${tag}`, 'MISSING_SCORE_LOGPROBS')
  }
  const byValue = new Map<number, number>()
  for (const alternative of alternatives) {
    let token = alternative.token.trim()
    if (token.startsWith('>')) token = token.slice(1).trim()
    const value = SCORE_VALUE.get(token)
    if (value === undefined || !Number.isFinite(alternative.logprob)) continue
    const probability = Math.exp(alternative.logprob)
    byValue.set(value, Math.max(byValue.get(value) ?? 0, probability))
  }
  const total = [...byValue.values()].reduce((sum, value) => sum + value, 0)
  if (!(total > 0)) {
    throw new VerifierError(`verifier response had no valid A-T alternatives after ${tag}`, 'MISSING_SCORE_TOKENS')
  }
  const expected = [...byValue].reduce((sum, [value, probability]) => sum + value * probability, 0) / total
  return (expected - 1) / (SCORE_GRANULARITY - 1)
}
