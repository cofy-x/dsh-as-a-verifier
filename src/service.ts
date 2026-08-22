/**
 * Public verifier service and orchestration derived in part from
 * llm-as-a-verifier at commit 115de305f23ed89bc42e86e010853c40059f3f7d
 * (MIT), including repeated A/B swapping and the two-phase PPT flow.
 * @module dsh-as-a-verifier/service
 */

import type { VerifierBackend } from './backend/deepseek.ts'
import { ScoreCache, type ScoreCacheKey } from './cache/score-cache.ts'
import type { ResolvedConfig } from './config.ts'
import { buildPairwisePrompt, PROMPT_VERSION } from './reward/prompt.ts'
import { extractExpectedScore } from './reward/score.ts'
import { bradleyTerry, pivotRoundPairs, ringCycle, selectPivots, type DirectedPair } from './tournament/ppt.ts'
import {
  VerifierError,
  type VerifierCompareRequest,
  type VerifierCompareResult,
  type VerifierCriterion,
  type VerifierCriterionScore,
  type VerifierSelectRequest,
  type VerifierSelectResult,
  type VerifierServiceApi,
} from './types.ts'
import { UsageAccumulator } from './usage.ts'

interface PairResult {
  readonly rewardA: number
  readonly rewardB: number
  readonly criterionScores: readonly VerifierCriterionScore[]
}

class Semaphore {
  private active = 0
  private readonly queue: (() => void)[] = []

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>(resolve => { this.queue.push(resolve) })
    this.active += 1
    try {
      return await operation()
    } finally {
      this.active -= 1
      this.queue.shift()?.()
    }
  }
}

function nonBlank(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new VerifierError(`${field} must be non-blank`, 'INVALID_ARGUMENT')
  return trimmed
}

function criteriaValid(criteria: readonly VerifierCriterion[], maximum: number): VerifierCriterion[] {
  if (criteria.length === 0) throw new VerifierError('criteria must not be empty', 'INVALID_ARGUMENT')
  if (criteria.length > maximum) throw new VerifierError(`criteria exceeds configured maximum ${maximum}`, 'LIMIT_EXCEEDED')
  const ids = new Set<string>()
  return criteria.map((criterion, index) => {
    const id = nonBlank(criterion.id, `criteria[${index}].id`)
    if (ids.has(id)) throw new VerifierError(`duplicate criterion id: ${id}`, 'INVALID_ARGUMENT')
    ids.add(id)
    return {
      id,
      name: nonBlank(criterion.name, `criteria[${index}].name`),
      description: nonBlank(criterion.description, `criteria[${index}].description`),
    }
  })
}

function bounded(value: number | undefined, fallback: number, maximum: number, field: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new VerifierError(`${field} must be a positive safe integer`, 'INVALID_ARGUMENT')
  if (resolved > maximum) throw new VerifierError(`${field} exceeds configured maximum ${maximum}`, 'LIMIT_EXCEEDED')
  return resolved
}

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new VerifierError('verifier operation was cancelled', 'CANCELLED', { cause: signal.reason })
}

async function settleStrict<T>(tasks: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(tasks)
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (rejected !== undefined) throw rejected.reason
  return settled.map(result => (result as PromiseFulfilledResult<T>).value)
}

/** Native TypeScript implementation of fine-grained pair scoring and PPT selection. */
export class VerifierService implements VerifierServiceApi {
  private accepting = true
  private readonly controllers = new Set<AbortController>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly semaphore: Semaphore

  constructor(
    private readonly config: ResolvedConfig,
    private readonly backend: VerifierBackend,
    private readonly cache: ScoreCache,
  ) {
    this.semaphore = new Semaphore(config.maxConcurrency)
  }

  compare(request: VerifierCompareRequest): Promise<VerifierCompareResult> {
    return this.operation(request.signal, async (signal) => {
      const problem = nonBlank(request.problem, 'problem')
      const traceA = nonBlank(request.traceA, 'traceA')
      const traceB = nonBlank(request.traceB, 'traceB')
      const criteria = criteriaValid(request.criteria, this.config.maxCriteria)
      const repeats = bounded(request.nEvaluations, this.config.nEvaluations, this.config.maxEvaluations, 'nEvaluations')
      const usage = new UsageAccumulator()
      const result = await this.scorePair(problem, traceA, traceB, criteria, repeats, usage, signal)
      const snapshot = usage.snapshot()
      return { ...result, verifierCalls: snapshot.calls, usage: snapshot }
    })
  }

  select(request: VerifierSelectRequest): Promise<VerifierSelectResult> {
    return this.operation(request.signal, async (signal) => {
      const problem = nonBlank(request.problem, 'problem')
      if (request.candidates.length === 0) throw new VerifierError('candidates must not be empty', 'INVALID_ARGUMENT')
      if (request.candidates.length > this.config.maxCandidates) {
        throw new VerifierError(`candidates exceeds configured maximum ${this.config.maxCandidates}`, 'LIMIT_EXCEEDED')
      }
      const candidates = request.candidates.map((candidate, index) => nonBlank(candidate, `candidates[${index}]`))
      const criteria = criteriaValid(request.criteria, this.config.maxCriteria)
      const repeats = bounded(request.nEvaluations, this.config.nEvaluations, this.config.maxEvaluations, 'nEvaluations')
      const requestedPivots = bounded(request.pivots, this.config.pivots, this.config.maxPivots, 'pivots')
      const pivots = Math.min(requestedPivots, candidates.length)
      const seed = request.seed ?? 0
      if (!Number.isSafeInteger(seed)) throw new VerifierError('seed must be a safe integer', 'INVALID_ARGUMENT')
      const usage = new UsageAccumulator()
      if (candidates.length === 1) {
        const snapshot = usage.snapshot()
        return {
          selectedIndex: 0,
          best: candidates[0] as string,
          ranking: [0],
          scores: [{ index: 0, score: 1 }],
          comparisonCount: 0,
          verifierCalls: 0,
          criteria,
          usage: snapshot,
        }
      }
      const winMass = candidates.map(() => 0)
      const counts = candidates.map(() => 0)
      const accumulate = async (pairs: readonly DirectedPair[]): Promise<void> => {
        const results = await settleStrict(pairs.map(async ([left, right]) => {
          cancelled(signal)
          const score = await this.scorePair(
            problem,
            candidates[left] as string,
            candidates[right] as string,
            criteria,
            repeats,
            usage,
            signal,
          )
          return { left, right, probability: bradleyTerry(score.rewardA, score.rewardB) }
        }))
        for (const { left, right, probability } of results) {
          winMass[left] = (winMass[left] as number) + probability
          counts[left] = (counts[left] as number) + 1
          winMass[right] = (winMass[right] as number) + 1 - probability
          counts[right] = (counts[right] as number) + 1
        }
      }
      const ring = ringCycle(candidates.length, seed)
      await accumulate(ring)
      const pivotSet = selectPivots(winMass, counts, pivots)
      const finalPairs = pivotRoundPairs(candidates.length, pivotSet)
      await accumulate(finalPairs)
      const scores = candidates.map((_, index) => ({
        index,
        score: counts[index] === 0 ? 0 : (winMass[index] as number) / (counts[index] as number),
      }))
      const ranking = scores.map(score => score.index)
        .sort((left, right) => (scores[right]?.score ?? 0) - (scores[left]?.score ?? 0) || left - right)
      const selectedIndex = ranking[0] as number
      const snapshot = usage.snapshot()
      return {
        selectedIndex,
        best: candidates[selectedIndex] as string,
        ranking,
        scores,
        comparisonCount: ring.length + finalPairs.length,
        verifierCalls: snapshot.calls,
        criteria,
        usage: snapshot,
      }
    })
  }

  /** Stop admission, abort every live request, and wait for operation quiescence. */
  async dispose(): Promise<void> {
    this.accepting = false
    for (const controller of this.controllers) controller.abort(new VerifierError('verifier plugin disposed', 'DISPOSED'))
    await Promise.allSettled([...this.operations])
  }

  private operation<T>(callerSignal: AbortSignal | undefined, body: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new VerifierError('verifier service is disposed', 'DISPOSED'))
    const controller = new AbortController()
    const onAbort = (): void => { controller.abort(callerSignal?.reason) }
    if (callerSignal?.aborted === true) onAbort()
    else callerSignal?.addEventListener('abort', onAbort, { once: true })
    this.controllers.add(controller)
    const task = body(controller.signal).finally(() => {
      callerSignal?.removeEventListener('abort', onAbort)
      this.controllers.delete(controller)
      this.operations.delete(task)
    })
    this.operations.add(task)
    return task
  }

  private async scorePair(
    problem: string,
    traceA: string,
    traceB: string,
    criteria: readonly VerifierCriterion[],
    repeats: number,
    usage: UsageAccumulator,
    signal: AbortSignal,
  ): Promise<PairResult> {
    const totals = new Map(criteria.map(criterion => [criterion.id, { a: 0, b: 0 }]))
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      cancelled(signal)
      const swapped = repeat % 2 === 1
      const promptA = swapped ? traceB : traceA
      const promptB = swapped ? traceA : traceB
      // Warm the shared, trace-heavy prefix before expanding criterion calls.
      const first = criteria[0] as VerifierCriterion
      const firstScore = await this.scoreCriterion(problem, promptA, promptB, first, repeat, swapped, usage, signal)
      const remaining = await settleStrict(criteria.slice(1).map(criterion =>
        this.scoreCriterion(problem, promptA, promptB, criterion, repeat, swapped, usage, signal)))
      for (const [index, score] of [firstScore, ...remaining].entries()) {
        const criterion = criteria[index] as VerifierCriterion
        const total = totals.get(criterion.id) as { a: number, b: number }
        total.a += swapped ? score.scoreB : score.scoreA
        total.b += swapped ? score.scoreA : score.scoreB
      }
    }
    const criterionScores = criteria.map((criterion) => {
      const total = totals.get(criterion.id) as { a: number, b: number }
      return { criterionId: criterion.id, rewardA: total.a / repeats, rewardB: total.b / repeats }
    })
    return {
      rewardA: criterionScores.reduce((sum, score) => sum + score.rewardA, 0) / criterionScores.length,
      rewardB: criterionScores.reduce((sum, score) => sum + score.rewardB, 0) / criterionScores.length,
      criterionScores,
    }
  }

  private async scoreCriterion(
    problem: string,
    traceA: string,
    traceB: string,
    criterion: VerifierCriterion,
    repeat: number,
    swapped: boolean,
    usage: UsageAccumulator,
    signal: AbortSignal,
  ): Promise<{ scoreA: number, scoreB: number }> {
    const key: ScoreCacheKey = {
      promptVersion: PROMPT_VERSION,
      backend: this.backend.id,
      model: this.backend.model,
      problem,
      traceA,
      traceB,
      criterion,
      repeat,
      slotOrder: swapped ? 'BA' : 'AB',
    }
    const cached = await this.cache.get(key)
    if (cached !== undefined) return { scoreA: cached.scoreA, scoreB: cached.scoreB }
    return this.semaphore.run(async () => {
      cancelled(signal)
      // Recheck after waiting: another in-process operation may have populated it.
      const lateCache = await this.cache.get(key)
      if (lateCache !== undefined) return { scoreA: lateCache.scoreA, scoreB: lateCache.scoreB }
      const response = await this.backend.score({ prompt: buildPairwisePrompt(problem, traceA, traceB, criterion), signal })
      const scoreA = extractExpectedScore(response.distribution, '<score_A>')
      const scoreB = extractExpectedScore(response.distribution, '<score_B>')
      usage.add(response.usage)
      await this.cache.set(key, { scoreA, scoreB, usage: response.usage })
      return { scoreA, scoreB }
    })
  }
}
