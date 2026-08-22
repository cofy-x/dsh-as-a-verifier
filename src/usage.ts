/** Operation-local verifier token accounting. @module dsh-as-a-verifier/usage */

import type { VerifierUsage } from './types.ts'

/** Mutable accumulator retained only for the duration of one public operation. */
export class UsageAccumulator {
  calls = 0
  inputTokens = 0
  cachedInputTokens = 0
  outputTokens = 0
  reasoningTokens = 0

  add(usage: Omit<VerifierUsage, 'uncachedInputTokens' | 'cacheHitRate'>): void {
    this.calls += usage.calls
    this.inputTokens += usage.inputTokens
    this.cachedInputTokens += usage.cachedInputTokens
    this.outputTokens += usage.outputTokens
    this.reasoningTokens += usage.reasoningTokens
  }

  snapshot(): VerifierUsage {
    return {
      calls: this.calls,
      inputTokens: this.inputTokens,
      cachedInputTokens: this.cachedInputTokens,
      uncachedInputTokens: Math.max(0, this.inputTokens - this.cachedInputTokens),
      outputTokens: this.outputTokens,
      reasoningTokens: this.reasoningTokens,
      cacheHitRate: this.inputTokens === 0 ? 0 : this.cachedInputTokens / this.inputTokens,
    }
  }
}
