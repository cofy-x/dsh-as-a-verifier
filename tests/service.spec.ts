import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ScoreCache } from '../src/cache/score-cache.ts'
import { VerifierService } from '../src/service.ts'
import { PromptBackend, resolvedConfig, scoreDistribution, zeroUsage } from './helpers.ts'
import type { ProgressEvaluator } from '../src/evaluator/progress.ts'

const criterion = { id: 'correct', name: 'Correctness', description: 'Judge correctness from the trace.' }
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('verifier service', () => {
  it('waits for an in-flight shadow evaluator to settle on service disposal', async () => {
    let started!: () => void
    let active = 0
    const ready = new Promise<void>(resolve => { started = resolve })
    const evaluator: ProgressEvaluator = {
      id: 'jev-test', model: 'jev-1.13.0', finalCheckpointOnly: true,
      async evaluate(request) {
        active += 1
        started()
        try {
          return await new Promise<never>((_resolve, reject) => {
            const abort = (): void => reject(new Error('cancelled'))
            if (request.signal.aborted) abort()
            else request.signal.addEventListener('abort', abort, { once: true })
          })
        } finally { active -= 1 }
      },
    }
    const service = new VerifierService(resolvedConfig({ progressEvaluatorMode: 'jev-shadow', nEvaluations: 1 }), new PromptBackend(), new ScoreCache('unused', false), undefined, evaluator)
    const pending = service.track({ problem: 'task', steps: ['output'] })
    const rejected = expect(pending).rejects.toThrow()
    await ready
    await service.dispose()
    await rejected
    expect(active).toBe(0)
    await expect(service.track({ problem: 'task', steps: ['later'] })).rejects.toMatchObject({ code: 'DISPOSED' })
  })
  it('retains successful shadow usage when another repeat fails', async () => {
    const evaluator: ProgressEvaluator = {
      id: 'jev-test', model: 'jev-1.13.0', finalCheckpointOnly: true,
      async evaluate(request) {
        if (request.repeat === 1) throw new Error('failure')
        return { scores: [0.9], probability: 0.9, provider: 'jev-test', model: 'jev-1.13.0', latencyMs: 1, cacheHit: false, usage: zeroUsage }
      },
    }
    const service = new VerifierService(resolvedConfig({ progressEvaluatorMode: 'jev-shadow' }), new PromptBackend(), new ScoreCache('unused', false), undefined, evaluator)
    const result = await service.track({ problem: 'task', steps: ['output'], checkpointSteps: [1] })
    expect(result.evaluation?.shadow).toMatchObject({ errorCode: 'JEV_SDK_ERROR', usage: { calls: 1, inputTokens: 10 } })
    expect(result.verifierCalls).toBe(2)
    await service.dispose()
  })
  function jevEvaluator(probability = 0.97, failure?: Error): ProgressEvaluator {
    return {
      id: 'jev-test', model: 'jev-1.13.0', finalCheckpointOnly: true,
      async evaluate() {
        if (failure !== undefined) throw failure
        return { scores: [probability], probability, provider: 'jev-test', model: 'jev-1.13.0', latencyMs: 3, cacheHit: false, usage: zeroUsage }
      },
    }
  }

  it('publishes an immutable protocol and capability contract', () => {
    const service = new VerifierService(resolvedConfig(), new PromptBackend(), new ScoreCache('unused', false))
    expect(service.protocolVersion).toBe(1)
    expect(service.capabilities).toEqual({
      pairwiseComparison: true,
      candidateSelection: true,
      offlineProgressTracking: true,
      onlineProgressTracking: true,
    })
    expect(Object.isFrozen(service.capabilities)).toBe(true)
  })

  it('tracks default checkpoints with one call per evaluation and strict progress scores', async () => {
    const backend = new PromptBackend()
    const service = new VerifierService(resolvedConfig(), backend, new ScoreCache('unused', false))
    const result = await service.track({ problem: 'task', steps: ['inspect', 'edit', 'verify', 'finish'] })
    expect(result.steps).toEqual([2, 3])
    expect(result.scores).toEqual([10 / 19, 1])
    expect(result.perEvaluationScores).toEqual([[10 / 19, 1], [10 / 19, 1]])
    expect(result.final).toBe(1)
    expect(result.verifierCalls).toBe(2)
  })

  it('uses Jev only when explicitly selected and preserves raw probability plus threshold decision', async () => {
    const service = new VerifierService(
      resolvedConfig({ progressEvaluatorMode: 'jev', nEvaluations: 1 }), new PromptBackend(), new ScoreCache('unused', false), undefined, jevEvaluator(0.94),
    )
    const result = await service.track({ problem: 'task', steps: ['verified result'], checkpointSteps: [1], nEvaluations: 1 })
    expect(result.final).toBe(0.94)
    expect(result.evaluation).toMatchObject({ mode: 'jev', rawScore: 0.94, threshold: 0.95, completed: false })
    const boundary = new VerifierService(
      resolvedConfig({ progressEvaluatorMode: 'jev', nEvaluations: 1, jevCompletionThreshold: 0.94 }), new PromptBackend(), new ScoreCache('unused', false), undefined, jevEvaluator(0.94),
    )
    expect((await boundary.track({ problem: 'task', steps: ['verified result'], nEvaluations: 1 })).evaluation?.completed).toBe(true)
    const defaultFinal = await service.track({ problem: 'task', steps: ['a', 'b', 'verified result'], nEvaluations: 1 })
    expect(defaultFinal.steps).toEqual([3])
    const tracker = service.createProgressTracker({ problem: 'task', nEvaluations: 1 })
    await tracker.update('verified result')
    expect(tracker.result().evaluation).toMatchObject({ mode: 'jev', rawScore: 0.94, completed: false })
    await tracker.dispose()
    await expect(service.track({ problem: 'task', steps: ['a', 'b'], checkpointSteps: [1], nEvaluations: 1 }))
      .rejects.toMatchObject({ code: 'JEV_FINAL_CHECKPOINT_ONLY' })
  })

  it('records shadow disagreement without changing existing scores or failure behavior', async () => {
    const existing = new PromptBackend()
    const service = new VerifierService(
      resolvedConfig({ progressEvaluatorMode: 'jev-shadow', nEvaluations: 1 }), existing, new ScoreCache('unused', false), undefined, jevEvaluator(0.1),
    )
    const result = await service.track({ problem: 'task', steps: ['verified result'], checkpointSteps: [1], nEvaluations: 1 })
    const baseline = await new VerifierService(
      resolvedConfig({ nEvaluations: 1 }), new PromptBackend(), new ScoreCache('unused', false),
    ).track({ problem: 'task', steps: ['verified result'], checkpointSteps: [1], nEvaluations: 1 })
    const { evaluation: _shadowMetadata, ...authoritative } = result
    expect(authoritative).toEqual(baseline)
    expect(result.evaluation?.shadow).toMatchObject({ probability: 0.1, completed: false, disagreement: true })

    const failedShadow = new VerifierService(
      resolvedConfig({ progressEvaluatorMode: 'jev-shadow', nEvaluations: 1 }), new PromptBackend(), new ScoreCache('unused', false), undefined, jevEvaluator(0, new Error('offline')),
    )
    const fallback = await failedShadow.track({ problem: 'task', steps: ['verified result'], checkpointSteps: [1], nEvaluations: 1 })
    expect(fallback.final).toBe(1)
    expect(fallback.evaluation?.shadow?.errorCode).toBe('JEV_SDK_ERROR')
  })

  it('fails explicit Jev mode on evaluator errors', async () => {
    const service = new VerifierService(
      resolvedConfig({ progressEvaluatorMode: 'jev', nEvaluations: 1 }), new PromptBackend(), new ScoreCache('unused', false), undefined, jevEvaluator(0, new Error('offline')),
    )
    await expect(service.track({ problem: 'task', steps: ['result'], checkpointSteps: [1], nEvaluations: 1 })).rejects.toThrow('offline')
  })

  it('enforces progress bounds and strictly increasing checkpoints', async () => {
    const service = new VerifierService(resolvedConfig({ maxProgressSteps: 2 }), new PromptBackend(), new ScoreCache('unused', false))
    await expect(service.track({ problem: 'task', steps: [] })).rejects.toThrow(/must not be empty/)
    await expect(service.track({ problem: 'task', steps: ['a', 'b', 'c'] })).rejects.toThrow(/configured maximum/)
    await expect(service.track({ problem: 'task', steps: ['a', 'b'], checkpointSteps: [2, 1] })).rejects.toThrow(/strictly increasing/)
    await expect(service.track({ problem: 'task', steps: ['a'], checkpointSteps: [2] })).rejects.toThrow(/within 1..1/)
  })

  it('tracks online prefixes without future steps and rejects concurrent updates', async () => {
    const prompts: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const backend = new PromptBackend()
    const original = backend.score.bind(backend)
    backend.score = async request => {
      prompts.push(request.prompt)
      if (prompts.length === 1) await gate
      return original(request)
    }
    const service = new VerifierService(resolvedConfig({ nEvaluations: 1 }), backend, new ScoreCache('unused', false))
    const tracker = service.createProgressTracker({ problem: 'task', nEvaluations: 1 })
    expect(() => tracker.result()).toThrow(/no scored steps/)
    const first = tracker.update('inspect')
    await Promise.resolve()
    await expect(tracker.update('future edit')).rejects.toMatchObject({ code: 'OPERATION_IN_PROGRESS' })
    release()
    await expect(first).resolves.toBe(1)
    await tracker.update('verify')
    expect(prompts[0]).not.toContain('future edit')
    expect(prompts[0]).not.toContain('verify')
    expect(prompts[1]).toContain('inspect')
    expect(prompts[1]).toContain('verify')
    expect(tracker.result()).toMatchObject({ steps: [1, 2], scores: [1, 1], verifierCalls: 2 })
    await tracker.dispose()
    await expect(tracker.update('later')).rejects.toMatchObject({ code: 'DISPOSED' })
  })
  it('cancels slot bias through repeated A/B swapping', async () => {
    const backend = new PromptBackend()
    const service = new VerifierService(resolvedConfig(), backend, new ScoreCache('unused', false))
    const result = await service.compare({ problem: 'task', traceA: 'GOOD', traceB: 'BAD', criteria: [criterion] })
    expect(result.rewardA).toBe(1)
    expect(result.rewardB).toBe(0)
    expect(result.criterionScores).toEqual([{ criterionId: 'correct', rewardA: 1, rewardB: 0 }])
    expect(result.verifierCalls).toBe(2)
    expect(result.usage).toMatchObject({ calls: 2, inputTokens: 20, cachedInputTokens: 4 })
  })

  it('selects, ranks, and reports the PPT budget deterministically', async () => {
    const backend = new PromptBackend()
    const service = new VerifierService(resolvedConfig(), backend, new ScoreCache('unused', false))
    const request = { problem: 'task', candidates: ['BAD', 'GOOD', 'MID'], criteria: [criterion], seed: 7 }
    const first = await service.select(request)
    const second = await service.select(request)
    expect(first.selectedIndex).toBe(1)
    expect(first.best).toBe('GOOD')
    expect(first.ranking).toEqual([1, 2, 0])
    expect(first.comparisonCount).toBe(6)
    expect(first.verifierCalls).toBe(12)
    expect(second.ranking).toEqual(first.ranking)
  })

  it('short-circuits one candidate without credentials or backend calls', async () => {
    const backend = new PromptBackend()
    const service = new VerifierService(resolvedConfig(), backend, new ScoreCache('unused', false))
    await expect(service.select({ problem: 'task', candidates: ['only'], criteria: [criterion] })).resolves.toMatchObject({
      selectedIndex: 0, best: 'only', ranking: [0], comparisonCount: 0, verifierCalls: 0,
    })
    expect(backend.calls).toBe(0)
  })

  it('uses cache hits without network usage in the current run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-service-'))
    roots.push(root)
    const backend = new PromptBackend()
    const service = new VerifierService(resolvedConfig({ cacheEnabled: true, dataDir: root }), backend, new ScoreCache(root, true))
    const request = { problem: 'task', traceA: 'GOOD', traceB: 'BAD', criteria: [criterion] }
    expect((await service.compare(request)).verifierCalls).toBe(2)
    expect((await service.compare(request)).verifierCalls).toBe(0)
    expect(backend.calls).toBe(2)
  })

  it('enforces empty input, duplicate ids, and deployment ceilings', async () => {
    const service = new VerifierService(resolvedConfig(), new PromptBackend(), new ScoreCache('unused', false))
    await expect(service.select({ problem: 'task', candidates: [], criteria: [criterion] })).rejects.toThrow(/must not be empty/)
    await expect(service.compare({ problem: 'task', traceA: 'a', traceB: 'b', criteria: [criterion, criterion] })).rejects.toThrow(/duplicate criterion/)
    await expect(service.select({ problem: 'task', candidates: ['a', 'b'], criteria: [criterion], nEvaluations: 9 })).rejects.toThrow('maximum')
  })

  it('enforces global concurrency and settles every started call on strict failure', async () => {
    let active = 0
    let peak = 0
    let calls = 0
    const backend = {
      id: 'controlled', model: 'controlled',
      async score() {
        const current = ++calls
        active += 1
        peak = Math.max(peak, active)
        await new Promise(resolve => setTimeout(resolve, 2))
        active -= 1
        if (current === 2) throw new Error('deliberate partial failure')
        return { distribution: scoreDistribution('A', 'T'), usage: zeroUsage }
      },
    }
    const service = new VerifierService(
      resolvedConfig({ maxConcurrency: 2, nEvaluations: 1 }), backend, new ScoreCache('unused', false),
    )
    await expect(service.select({
      problem: 'task', candidates: ['a', 'b', 'c'], criteria: [criterion], nEvaluations: 1,
    })).rejects.toThrow('deliberate partial failure')
    expect(peak).toBeLessThanOrEqual(2)
    expect(active).toBe(0)
  })
})
