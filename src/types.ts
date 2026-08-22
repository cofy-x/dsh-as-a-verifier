/** Public verifier request and result vocabulary. @module dsh-as-a-verifier/types */

/** One independently scored, trajectory-observable evaluation criterion. */
export interface VerifierCriterion {
  readonly id: string
  readonly name: string
  readonly description: string
}

/** Token usage produced by network calls in one public verifier operation. */
export interface VerifierUsage {
  readonly calls: number
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly cacheHitRate: number
}

/** Shared operation controls. */
export interface VerifierOperationOptions {
  readonly nEvaluations?: number
  readonly signal?: AbortSignal
}

/** Compare two trajectories against the same problem and criteria. */
export interface VerifierCompareRequest extends VerifierOperationOptions {
  readonly problem: string
  readonly traceA: string
  readonly traceB: string
  readonly criteria: readonly VerifierCriterion[]
}

/** Mean rewards for one criterion after all repeated evaluations. */
export interface VerifierCriterionScore {
  readonly criterionId: string
  readonly rewardA: number
  readonly rewardB: number
}

/** Fine-grained reward result for a pair of trajectories. */
export interface VerifierCompareResult {
  readonly rewardA: number
  readonly rewardB: number
  readonly criterionScores: readonly VerifierCriterionScore[]
  readonly verifierCalls: number
  readonly usage: VerifierUsage
}

/** Select the strongest trajectory through a seeded probabilistic pivot tournament. */
export interface VerifierSelectRequest extends VerifierOperationOptions {
  readonly problem: string
  readonly candidates: readonly string[]
  readonly criteria: readonly VerifierCriterion[]
  readonly pivots?: number
  readonly seed?: number
}

/** Candidate score projected from accumulated Bradley-Terry win mass. */
export interface VerifierCandidateScore {
  readonly index: number
  readonly score: number
}

/** Best-of-N selection result. */
export interface VerifierSelectResult {
  readonly selectedIndex: number
  readonly best: string
  readonly ranking: readonly number[]
  readonly scores: readonly VerifierCandidateScore[]
  readonly comparisonCount: number
  readonly verifierCalls: number
  readonly criteria: readonly VerifierCriterion[]
  readonly usage: VerifierUsage
}

/** Public service provided as `ctx.verifier`. */
export interface VerifierServiceApi {
  compare(request: VerifierCompareRequest): Promise<VerifierCompareResult>
  select(request: VerifierSelectRequest): Promise<VerifierSelectResult>
}

/** Stable machine-readable verifier failure. */
export class VerifierError extends Error {
  constructor(message: string, readonly code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VerifierError'
  }
}
