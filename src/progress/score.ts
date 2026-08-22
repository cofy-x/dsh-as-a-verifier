/**
 * Strict A-T progress expectation derived from llm-as-a-verifier at commit
 * 115de305f23ed89bc42e86e010853c40059f3f7d (MIT).
 * @module dsh-as-a-verifier/progress/score
 */

import type { TokenAlternative, TokenDistribution } from '../reward/score.ts'
import { VerifierError } from '../types.ts'

const GRANULARITY = 20

const VALUE = new Map<string, number>(Array.from({ length: GRANULARITY }, (_, index) => {
  const letter = String.fromCharCode(65 + index)
  return [[letter, index / (GRANULARITY - 1)], [letter.toLowerCase(), index / (GRANULARITY - 1)]] as const
}).flat())

function expected(alternatives: readonly TokenAlternative[]): number | undefined {
  const byValue = new Map<number, number>()
  for (const alternative of alternatives) {
    const token = alternative.token.trimStart().replace(/^>/u, '').trimStart()
    const value = VALUE.get(token[0] ?? '')
    if (value === undefined || !Number.isFinite(alternative.logprob)) continue
    const previous = byValue.get(value)
    if (previous === undefined || alternative.logprob > previous) byValue.set(value, alternative.logprob)
  }
  if (byValue.size === 0) return undefined
  const maximum = Math.max(...byValue.values())
  let numerator = 0
  let denominator = 0
  for (const [value, logprob] of byValue) {
    const probability = Math.exp(logprob - maximum)
    numerator += value * probability
    denominator += probability
  }
  return numerator / denominator
}

/** Decode every `<cN>` score at the exact generated token position after its tag. */
export function extractProgressScores(distribution: TokenDistribution, count: number): number[] {
  if (distribution.tokens.length !== distribution.positionLogprobs.length) {
    throw new VerifierError('verifier token and logprob position counts differ', 'INVALID_LOGPROBS')
  }
  const joined = distribution.tokens.join('')
  const ends: number[] = []
  let end = 0
  for (const token of distribution.tokens) {
    end += token.length
    ends.push(end)
  }
  const scores: number[] = []
  for (let checkpoint = 1; checkpoint <= count; checkpoint += 1) {
    const tag = `<c${checkpoint}>`
    const index = joined.indexOf(tag)
    if (index < 0) throw new VerifierError(`verifier response omitted ${tag}`, 'MISSING_SCORE_LOGPROBS')
    const target = index + tag.length
    const position = ends.findIndex(candidate => candidate > target)
    if (position < 0) throw new VerifierError(`verifier response did not expose logprobs after ${tag}`, 'MISSING_SCORE_LOGPROBS')
    const score = expected(distribution.positionLogprobs[position] ?? [])
    if (score === undefined) throw new VerifierError(`verifier response had no valid A-T alternatives after ${tag}`, 'MISSING_SCORE_TOKENS')
    scores.push(score)
  }
  return scores
}
