/**
 * Public verifier service and orchestration derived in part from
 * llm-as-a-verifier at commit 8db8a114355a9d7fdf9a8d1d5c87f6aeebd18770
 * (MIT), including repeated A/B swapping and the two-phase PPT flow.
 * @module dsh-as-a-verifier/service
 */

import type { VerifierBackend } from './backend/deepseek.ts'
import { ScoreCache, type ScoreCacheKey } from './cache/score-cache.ts'
import { ProgressCache, type ProgressCacheKey } from './cache/progress-cache.ts'
import type { ResolvedConfig } from './config.ts'
import { buildProgressPrompt, PROGRESS_PROMPT_VERSION } from './progress/prompt.ts'
import { extractProgressScores } from './progress/score.ts'
import { buildPairwisePrompt, PROMPT_VERSION } from './reward/prompt.ts'
import { extractExpectedScore } from './reward/score.ts'
import { bradleyTerry, pivotRoundPairs, ringCycle, selectPivots, type DirectedPair } from './tournament/ppt.ts'
import {
  VERIFIER_CAPABILITIES,
  VERIFIER_PROTOCOL_VERSION,
  VerifierError,
  type VerifierCompareRequest,
  type VerifierCompareResult,
  type VerifierCriterion,
  type VerifierCriterionScore,
  type VerifierProgressEvaluation,
  type VerifierProgressTracker,
  type VerifierProgressTrackerOptions,
  type VerifierSelectRequest,
  type VerifierSelectResult,
  type VerifierServiceApi,
  type VerifierTrackRequest,
  type VerifierTrackResult,
} from './types.ts'
import { UsageAccumulator } from './usage.ts'
import type { ProgressEvaluation, ProgressEvaluator } from './evaluator/progress.ts'

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
  readonly protocolVersion = VERIFIER_PROTOCOL_VERSION
  readonly capabilities = VERIFIER_CAPABILITIES
  private accepting = true
  private readonly controllers = new Set<AbortController>()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly semaphore: Semaphore
  private readonly trackers = new Set<ProgressTracker>()

  constructor(
    private readonly config: ResolvedConfig,
    private readonly backend: VerifierBackend,
    private readonly cache: ScoreCache,
    private readonly progressCache = new ProgressCache(config.dataDir, config.cacheEnabled),
    private readonly jevEvaluator?: ProgressEvaluator,
  ) {
    this.semaphore = new Semaphore(config.maxConcurrency)
  }

  track(request: VerifierTrackRequest): Promise<VerifierTrackResult> {
    return this.operation(request.signal, async (signal) => {
      const problem = nonBlank(request.problem, 'problem')
      if (request.steps.length === 0) throw new VerifierError('steps must not be empty', 'INVALID_ARGUMENT')
      if (request.steps.length > this.config.maxProgressSteps) {
        throw new VerifierError(`steps exceeds configured maximum ${this.config.maxProgressSteps}`, 'LIMIT_EXCEEDED')
      }
      const steps = request.steps.map((step, index) => {
        const value = nonBlank(step, `steps[${index}]`)
        if (value.length > this.config.maxProgressStepChars) {
          throw new VerifierError(`steps[${index}] exceeds configured character maximum ${this.config.maxProgressStepChars}`, 'LIMIT_EXCEEDED')
        }
        return value
      })
      const totalChars = steps.reduce((sum, step) => sum + step.length, 0)
      if (totalChars > this.config.maxProgressTrajectoryChars) {
        throw new VerifierError(`trajectory exceeds configured character maximum ${this.config.maxProgressTrajectoryChars}`, 'LIMIT_EXCEEDED')
      }
      const checkpoints = request.checkpointSteps === undefined
        ? (this.config.progressEvaluatorMode === 'jev'
            ? [steps.length]
            : (steps.length > 2 ? Array.from({ length: steps.length - 2 }, (_, index) => index + 2) : steps.map((_, index) => index + 1)))
        : [...request.checkpointSteps]
      if (checkpoints.length === 0) throw new VerifierError('checkpointSteps must not be empty', 'INVALID_ARGUMENT')
      if (checkpoints.length > this.config.maxProgressCheckpoints) {
        throw new VerifierError(`checkpointSteps exceeds configured maximum ${this.config.maxProgressCheckpoints}`, 'LIMIT_EXCEEDED')
      }
      for (let index = 0; index < checkpoints.length; index += 1) {
        const checkpoint = checkpoints[index] as number
        if (!Number.isSafeInteger(checkpoint) || checkpoint < 1 || checkpoint > steps.length) {
          throw new VerifierError(`checkpointSteps[${index}] must be within 1..${steps.length}`, 'INVALID_ARGUMENT')
        }
        if (index > 0 && checkpoint <= (checkpoints[index - 1] as number)) {
          throw new VerifierError('checkpointSteps must be strictly increasing and unique', 'INVALID_ARGUMENT')
        }
      }
      const repeats = bounded(request.nEvaluations, this.config.nEvaluations, this.config.maxEvaluations, 'nEvaluations')
      if (this.config.progressEvaluatorMode === 'jev') {
        const jevStarted = performance.now()
        if (this.jevEvaluator === undefined) throw new VerifierError('Jev evaluator is unavailable', 'JEV_UNAVAILABLE')
        if (checkpoints.length !== 1 || checkpoints[0] !== steps.length) {
          throw new VerifierError('Jev progress evaluation currently supports only the final checkpoint', 'JEV_FINAL_CHECKPOINT_ONLY')
        }
        const evaluations = await settleStrict(Array.from({ length: repeats }, (_, repeat) =>
          this.jevEvaluator?.evaluate({ problem, steps, checkpointSteps: checkpoints, repeat, signal }) as Promise<ProgressEvaluation>))
        const usage = new UsageAccumulator()
        for (const evaluation of evaluations) usage.add(evaluation.usage)
        const perEvaluationScores = evaluations.map(evaluation => [...evaluation.scores])
        const scores = checkpoints.map((_, index) =>
          perEvaluationScores.reduce((sum, evaluation) => sum + (evaluation[index] as number), 0) / repeats)
        const snapshot = usage.snapshot()
        const rawScore = scores.at(-1) as number
        return {
          steps: checkpoints,
          scores,
          perEvaluationScores,
          final: rawScore,
          verifierCalls: snapshot.calls,
          usage: snapshot,
          evaluation: {
            mode: 'jev',
            provider: this.jevEvaluator.id,
            model: this.jevEvaluator.model,
            rawScore,
            threshold: this.config.jevCompletionThreshold,
            completed: rawScore >= this.config.jevCompletionThreshold,
            latencyMs: performance.now() - jevStarted,
            cacheHits: evaluations.filter(evaluation => evaluation.cacheHit).length,
          },
        }
      }

      const usage = new UsageAccumulator()
      const existingStarted = performance.now()
      const perEvaluationScores = await settleStrict(Array.from({ length: repeats }, (_, repeat) =>
        this.scoreProgress(problem, steps, checkpoints, repeat, usage, signal)))
      const scores = checkpoints.map((_, index) =>
        perEvaluationScores.reduce((sum, evaluation) => sum + (evaluation[index] as number), 0) / repeats)
      const snapshot = usage.snapshot()
      const existingLatencyMs = performance.now() - existingStarted
      const existingCacheHits = Math.max(0, repeats - snapshot.calls)
      const result: VerifierTrackResult = {
        steps: checkpoints,
        scores,
        perEvaluationScores,
        final: scores.at(-1) as number,
        verifierCalls: snapshot.calls,
        usage: snapshot,
      }
      if (this.config.progressEvaluatorMode !== 'jev-shadow') return result
      if (this.jevEvaluator === undefined) throw new VerifierError('Jev evaluator is unavailable', 'JEV_UNAVAILABLE')
      const shadowStarted = performance.now()
      const shadowUsage = new UsageAccumulator()
      let shadowCacheHits = 0
      try {
        if (!checkpoints.includes(steps.length)) {
          return {
            ...result,
            evaluation: {
              mode: 'jev-shadow', provider: this.backend.id, model: this.backend.model,
              rawScore: result.final, latencyMs: existingLatencyMs, cacheHits: existingCacheHits,
              shadow: {
                provider: this.jevEvaluator.id, model: this.jevEvaluator.model,
                threshold: this.config.jevCompletionThreshold, latencyMs: 0, cacheHit: false,
                usage: new UsageAccumulator().snapshot(), errorCode: 'JEV_FINAL_CHECKPOINT_ONLY',
              },
            },
          }
        }
        const evaluations = await settleStrict(Array.from({ length: repeats }, async (_, repeat) => {
          const evaluation = await this.jevEvaluator!.evaluate({ problem, steps, checkpointSteps: [steps.length], repeat, signal })
          shadowUsage.add(evaluation.usage)
          if (evaluation.cacheHit) shadowCacheHits += 1
          return evaluation
        }))
        const probability = evaluations.reduce((sum, evaluation) => sum + (evaluation.probability as number), 0) / repeats
        const completed = probability >= this.config.jevCompletionThreshold
        return {
          ...result,
          evaluation: {
            mode: 'jev-shadow', provider: this.backend.id, model: this.backend.model,
            rawScore: result.final, latencyMs: existingLatencyMs, cacheHits: existingCacheHits,
            shadow: {
              provider: this.jevEvaluator.id,
              model: this.jevEvaluator.model,
              probability,
              threshold: this.config.jevCompletionThreshold,
              completed,
              disagreement: completed !== (result.final >= this.config.jevShadowExistingThreshold),
              latencyMs: performance.now() - shadowStarted,
              cacheHit: evaluations.every(evaluation => evaluation.cacheHit),
              usage: shadowUsage.snapshot(),
            },
          },
        }
      } catch (error) {
        if (signal.aborted) throw error
        return {
          ...result,
          evaluation: {
            mode: 'jev-shadow', provider: this.backend.id, model: this.backend.model,
            rawScore: result.final, latencyMs: existingLatencyMs, cacheHits: existingCacheHits,
            shadow: {
              provider: this.jevEvaluator.id,
              model: this.jevEvaluator.model,
              threshold: this.config.jevCompletionThreshold,
              latencyMs: performance.now() - shadowStarted,
              cacheHit: shadowCacheHits === repeats,
              usage: shadowUsage.snapshot(),
              errorCode: error instanceof VerifierError ? error.code : 'JEV_SDK_ERROR',
            },
          },
        }
      }
    })
  }

  createProgressTracker(options: VerifierProgressTrackerOptions): VerifierProgressTracker {
    if (!this.accepting) throw new VerifierError('verifier service is disposed', 'DISPOSED')
    const problem = nonBlank(options.problem, 'problem')
    const repeats = bounded(options.nEvaluations, this.config.nEvaluations, this.config.maxEvaluations, 'nEvaluations')
    const tracker = new ProgressTracker(this, problem, repeats, () => { this.trackers.delete(tracker) })
    this.trackers.add(tracker)
    return tracker
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
    await Promise.allSettled([...this.trackers].map(tracker => tracker.dispose()))
    for (const controller of this.controllers) controller.abort(new VerifierError('verifier plugin disposed', 'DISPOSED'))
    await Promise.allSettled([...this.operations])
  }

  private async scoreProgress(
    problem: string,
    steps: readonly string[],
    checkpoints: readonly number[],
    repeat: number,
    usage: UsageAccumulator,
    signal: AbortSignal,
  ): Promise<number[]> {
    const key: ProgressCacheKey = {
      promptVersion: PROGRESS_PROMPT_VERSION,
      backend: this.backend.id,
      model: this.backend.model,
      problem,
      steps,
      checkpoints,
      repeat,
    }
    const cached = await this.progressCache.get(key)
    if (cached !== undefined && cached.scores.length === checkpoints.length) return [...cached.scores]
    return this.semaphore.run(async () => {
      cancelled(signal)
      const lateCache = await this.progressCache.get(key)
      if (lateCache !== undefined && lateCache.scores.length === checkpoints.length) return [...lateCache.scores]
      const response = await this.backend.score({ prompt: buildProgressPrompt(problem, steps, checkpoints), signal })
      const scores = extractProgressScores(response.distribution, checkpoints.length)
      usage.add(response.usage)
      await this.progressCache.set(key, { scores, usage: response.usage })
      return scores
    })
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

class ProgressTracker implements VerifierProgressTracker {
  private readonly steps: string[] = []
  private readonly scores: number[] = []
  private readonly perEvaluationScores: number[][] = []
  private readonly usage = new UsageAccumulator()
  private evaluation: VerifierProgressEvaluation | undefined
  private active: AbortController | undefined
  private activeTask: Promise<VerifierTrackResult> | undefined
  private disposed = false

  constructor(
    private readonly service: VerifierService,
    private readonly problem: string,
    private readonly nEvaluations: number,
    private readonly onDispose: () => void,
  ) {}

  async update(step: string, options: { readonly signal?: AbortSignal } = {}): Promise<number> {
    if (this.disposed) throw new VerifierError('progress tracker is disposed', 'DISPOSED')
    if (this.active !== undefined) throw new VerifierError('progress tracker update is already in progress', 'OPERATION_IN_PROGRESS')
    const controller = new AbortController()
    const onAbort = (): void => { controller.abort(options.signal?.reason) }
    if (options.signal?.aborted === true) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
    this.active = controller
    try {
      const candidateSteps = [...this.steps, step]
      const task = this.service.track({
        problem: this.problem,
        steps: candidateSteps,
        checkpointSteps: [candidateSteps.length],
        nEvaluations: this.nEvaluations,
        signal: controller.signal,
      })
      this.activeTask = task
      const result = await task
      this.steps.push(step)
      this.scores.push(result.final)
      if (this.perEvaluationScores.length === 0) {
        for (let index = 0; index < result.perEvaluationScores.length; index += 1) this.perEvaluationScores.push([])
      }
      result.perEvaluationScores.forEach((evaluation, index) => {
        ;(this.perEvaluationScores[index] as number[]).push(evaluation[0] as number)
      })
      this.usage.add(result.usage)
      this.evaluation = result.evaluation
      return result.final
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
      this.active = undefined
      this.activeTask = undefined
    }
  }

  result(): VerifierTrackResult {
    if (this.steps.length === 0) throw new VerifierError('progress tracker has no scored steps', 'INVALID_STATE')
    const usage = this.usage.snapshot()
    return {
      steps: this.steps.map((_, index) => index + 1),
      scores: [...this.scores],
      perEvaluationScores: this.perEvaluationScores.map(row => [...row]),
      final: this.scores.at(-1) as number,
      verifierCalls: usage.calls,
      usage,
      ...(this.evaluation === undefined ? {} : { evaluation: this.evaluation }),
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.active?.abort(new VerifierError('progress tracker disposed', 'DISPOSED'))
    if (this.activeTask !== undefined) await Promise.allSettled([this.activeTask])
    this.onDispose()
  }
}
