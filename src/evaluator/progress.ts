/** Provider-neutral semantic progress evaluation boundary. */

import type { VerifierUsage } from '../types.ts'

export interface ProgressEvaluationRequest {
  readonly problem: string
  readonly steps: readonly string[]
  readonly checkpointSteps: readonly number[]
  readonly repeat: number
  readonly signal: AbortSignal
}

export interface ProgressEvaluation {
  readonly scores: readonly number[]
  readonly provider: string
  readonly model: string
  readonly latencyMs: number
  readonly cacheHit: boolean
  readonly usage: VerifierUsage
  readonly probability?: number
}

/** A semantic evaluator owns the meaning and transport of progress scores. */
export interface ProgressEvaluator {
  readonly id: string
  readonly model: string
  readonly finalCheckpointOnly: boolean
  evaluate(request: ProgressEvaluationRequest): Promise<ProgressEvaluation>
}

/** Reserved seam for a future Jev Choice-based pairwise experiment. */
export interface PairwiseEvaluationRequest {
  readonly problem: string
  readonly candidateA: string
  readonly candidateB: string
  readonly criterion: { readonly id: string, readonly name: string, readonly description: string }
  readonly signal: AbortSignal
}

export interface PairwiseEvaluation {
  readonly probabilityA: number
  readonly probabilityB: number
  readonly tieProbability: number
  readonly provider: string
  readonly model: string
  readonly latencyMs: number
  readonly usage: VerifierUsage
}

export interface PairwiseEvaluator {
  readonly id: string
  readonly model: string
  evaluate(request: PairwiseEvaluationRequest): Promise<PairwiseEvaluation>
}
