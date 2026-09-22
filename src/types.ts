/** Public verifier request and result vocabulary. @module dsh-as-a-verifier/types */

/** Current structural contract implemented by `ctx.verifier`. */
export const VERIFIER_PROTOCOL_VERSION = 1 as const

/** Feature discovery for consumers that can operate against several provider releases. */
export interface VerifierCapabilities {
  readonly pairwiseComparison: boolean
  readonly candidateSelection: boolean
  readonly offlineProgressTracking: boolean
  readonly onlineProgressTracking: boolean
}

/** Capabilities shipped by this provider release. */
export const VERIFIER_CAPABILITIES: Readonly<VerifierCapabilities> = Object.freeze({
  pairwiseComparison: true,
  candidateSelection: true,
  offlineProgressTracking: true,
  onlineProgressTracking: true,
})

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

/** Score selected 1-based checkpoints along one agent trajectory. */
export interface VerifierTrackRequest extends VerifierOperationOptions {
  readonly problem: string
  readonly steps: readonly string[]
  readonly checkpointSteps?: readonly number[]
}

/** Strict progress curve decoded independently for every evaluation repeat. */
export interface VerifierTrackResult {
  readonly steps: readonly number[]
  readonly scores: readonly number[]
  readonly perEvaluationScores: readonly (readonly number[])[]
  readonly final: number
  readonly verifierCalls: number
  readonly usage: VerifierUsage
  /** Experimental provider observation. Omitted in the default `existing` mode; an online tracker reports its latest update. */
  readonly evaluation?: VerifierProgressEvaluation
}

export interface VerifierProgressShadowEvaluation {
  readonly provider: string
  readonly model: string
  readonly probability?: number
  readonly threshold: number
  readonly completed?: boolean
  readonly disagreement?: boolean
  readonly latencyMs: number
  readonly cacheHit: boolean
  readonly usage: VerifierUsage
  readonly errorCode?: string
}

/** Structured, content-free metadata for experimental progress evaluation. */
export interface VerifierProgressEvaluation {
  readonly mode: 'jev' | 'jev-shadow'
  readonly provider: string
  readonly model: string
  readonly rawScore: number
  readonly threshold?: number
  readonly completed?: boolean
  readonly latencyMs: number
  readonly cacheHits: number
  readonly shadow?: VerifierProgressShadowEvaluation
}

/** Options captured by an online prefix-only progress tracker. */
export interface VerifierProgressTrackerOptions {
  readonly problem: string
  readonly nEvaluations?: number
}

/** Stateful prefix tracker owned by the verifier plugin lifecycle. */
export interface VerifierProgressTracker {
  update(step: string, options?: { readonly signal?: AbortSignal }): Promise<number>
  result(): VerifierTrackResult
  dispose(): Promise<void>
}

/** Public service provided as `ctx.verifier`. */
export interface VerifierServiceApi {
  readonly protocolVersion: typeof VERIFIER_PROTOCOL_VERSION
  readonly capabilities: Readonly<VerifierCapabilities>
  compare(request: VerifierCompareRequest): Promise<VerifierCompareResult>
  select(request: VerifierSelectRequest): Promise<VerifierSelectResult>
  track(request: VerifierTrackRequest): Promise<VerifierTrackResult>
  createProgressTracker(options: VerifierProgressTrackerOptions): VerifierProgressTracker
}

/** Stable machine-readable verifier failure. */
export class VerifierError extends Error {
  constructor(message: string, readonly code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VerifierError'
  }
}
