import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JevProgressCache, jevProgressCacheDigest, type JevProgressCacheKey } from '../src/cache/jev-progress-cache.ts'
import { assertJevRuntime, JevProgressEvaluator, type JevClientFactory } from '../src/evaluator/jev.ts'
import { resolvedConfig, zeroUsage } from './helpers.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

function wire(probability = 0.96, model = 'jev-1.13.0') {
  return {
    model,
    answers: { complete: { type: 'noul', noul: probability } },
    usage: { input_tokens: 17, output_tokens: 0 },
  }
}

describe('Jev progress evaluator', () => {
  it('cancels queued calls promptly and never sends after credential resolution is cancelled', async () => {
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const evaluate = vi.fn(async (request: { signal: AbortSignal }) => {
      started()
      return new Promise<ReturnType<typeof wire>>((_resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true }))
    })
    const evaluator = new JevProgressEvaluator(resolvedConfig({ jevMaxConcurrency: 1 }), async () => 'key', new JevProgressCache('unused', false), async () => ({ evaluate }))
    const firstController = new AbortController()
    const request = { problem: 'task', steps: ['output'], checkpointSteps: [1], repeat: 0, signal: firstController.signal }
    const first = evaluator.evaluate(request)
    const firstRejected = expect(first).rejects.toMatchObject({ code: 'CANCELLED' })
    await ready
    const queuedController = new AbortController()
    const queued = evaluator.evaluate({ ...request, signal: queuedController.signal })
    await new Promise(resolve => setTimeout(resolve, 0))
    queuedController.abort()
    await expect(queued).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(evaluate).toHaveBeenCalledTimes(1)
    firstController.abort()
    await firstRejected

    const controller = new AbortController()
    const credentialCancelled = new JevProgressEvaluator(resolvedConfig(), async () => { controller.abort(); return 'key' }, new JevProgressCache('unused', false), async () => ({ evaluate }))
    await expect(credentialCancelled.evaluate({ ...request, signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(evaluate).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed top-level responses and removes sensitive SDK causes', async () => {
    const request = { problem: 'task', steps: ['output'], checkpointSteps: [1], repeat: 0, signal: new AbortController().signal }
    const malformed = new JevProgressEvaluator(resolvedConfig(), async () => 'key', new JevProgressCache('unused', false), async () => ({ evaluate: async () => null as never }))
    await expect(malformed.evaluate(request)).rejects.toMatchObject({ code: 'JEV_INVALID_RESPONSE' })
    const failed = new JevProgressEvaluator(resolvedConfig(), async () => 'key', new JevProgressCache('unused', false), async () => ({ evaluate: async () => { throw new Error('private-body-and-key') } }))
    try { await failed.evaluate(request); expect.unreachable() } catch (error) {
      expect(error).toMatchObject({ code: 'JEV_SDK_ERROR' })
      expect((error as Error).cause).toBeUndefined()
    }
  })
  it('sends a validated final-only request and preserves the raw probability', async () => {
    const evaluate = vi.fn(async () => wire())
    const createClient: JevClientFactory = async options => {
      expect(options).toEqual({ apiKey: 'rotated-key', baseURL: 'https://api.typesafe.ai' })
      return { evaluate }
    }
    const evaluator = new JevProgressEvaluator(
      resolvedConfig({ progressEvaluatorMode: 'jev', jevTimeoutMs: 1234, jevRetryAttempts: 2 }),
      async () => 'rotated-key',
      new JevProgressCache('unused', false),
      createClient,
    )
    const result = await evaluator.evaluate({
      problem: 'Fix the parser and run tests.', steps: ['changed parser', 'tests passed'],
      checkpointSteps: [2], repeat: 0, signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ scores: [0.96], probability: 0.96, provider: 'typesafe-jev-noul-v1', model: 'jev-1.13.0', cacheHit: false })
    expect(result.usage).toMatchObject({ calls: 1, inputTokens: 17, outputTokens: 0 })
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'jev-1.13.0', timeoutMs: 1234, maxRetries: 1,
      state: { objective: 'Fix the parser and run tests.', result: expect.stringContaining('tests passed') },
    }))
  })

  it('strictly rejects non-final checkpoints and malformed wire responses', async () => {
    const invalid: JevClientFactory = async () => ({ evaluate: async () => wire(1.2) })
    const evaluator = new JevProgressEvaluator(resolvedConfig({ progressEvaluatorMode: 'jev' }), async () => 'key', new JevProgressCache('unused', false), invalid)
    await expect(evaluator.evaluate({ problem: 'task', steps: ['a', 'b'], checkpointSteps: [1], repeat: 0, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'JEV_FINAL_CHECKPOINT_ONLY' })
    await expect(evaluator.evaluate({ problem: 'task', steps: ['a'], checkpointSteps: [1], repeat: 0, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'JEV_INVALID_RESPONSE' })
  })

  it('reports timeout, cancellation, missing credentials, and SDK errors without leaking secrets', async () => {
    const hanging: JevClientFactory = async () => ({
      evaluate: async request => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })),
    })
    const timeout = new JevProgressEvaluator(resolvedConfig({ progressEvaluatorMode: 'jev', jevTimeoutMs: 5 }), async () => 'do-not-leak', new JevProgressCache('unused', false), hanging)
    const request = { problem: 'task', steps: ['result'], checkpointSteps: [1], repeat: 0, signal: new AbortController().signal }
    await expect(timeout.evaluate(request)).rejects.toMatchObject({ code: 'JEV_REQUEST_TIMEOUT' })

    const controller = new AbortController()
    const pending = timeout.evaluate({ ...request, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })

    const missing = new JevProgressEvaluator(resolvedConfig({ progressEvaluatorMode: 'jev' }), async () => undefined, new JevProgressCache('unused', false), hanging)
    await expect(missing.evaluate(request)).rejects.toMatchObject({ code: 'JEV_MISSING_CREDENTIAL' })

    const broken = new JevProgressEvaluator(resolvedConfig({ progressEvaluatorMode: 'jev' }), async () => 'do-not-leak', new JevProgressCache('unused', false), async () => ({ evaluate: async () => { throw new Error('sdk failed') } }))
    let diagnostic = ''
    try { await broken.evaluate(request) } catch (error) { diagnostic = String(error) }
    expect(diagnostic).not.toContain('do-not-leak')

    const sdkTimeout = new JevProgressEvaluator(resolvedConfig({ progressEvaluatorMode: 'jev' }), async () => 'key', new JevProgressCache('unused', false), async () => ({
      evaluate: async () => { throw Object.assign(new Error('sdk timeout'), { name: 'APITimeoutError' }) },
    }))
    await expect(sdkTimeout.evaluate(request)).rejects.toMatchObject({ code: 'JEV_REQUEST_TIMEOUT' })
  })

  it('isolates cache identities and never stores task content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-jev-cache-'))
    roots.push(root)
    const key: JevProgressCacheKey = {
      schemaVersion: 'v1', provider: 'jev', model: 'jev-1.13.0', problem: 'private objective', result: 'private result', repeat: 0,
    }
    expect(jevProgressCacheDigest({ ...key, provider: 'other' })).not.toBe(jevProgressCacheDigest(key))
    expect(jevProgressCacheDigest({ ...key, model: 'jev-1.14.0' })).not.toBe(jevProgressCacheDigest(key))
    expect(jevProgressCacheDigest({ ...key, schemaVersion: 'v2' })).not.toBe(jevProgressCacheDigest(key))
    expect(jevProgressCacheDigest({ ...key, problem: 'other' })).not.toBe(jevProgressCacheDigest(key))
    expect(jevProgressCacheDigest({ ...key, result: 'other' })).not.toBe(jevProgressCacheDigest(key))
    expect(jevProgressCacheDigest({ ...key, repeat: 1 })).not.toBe(jevProgressCacheDigest(key))
    const cache = new JevProgressCache(root)
    await cache.set(key, { probability: 0.91, model: key.model, usage: zeroUsage })
    expect(await cache.get(key)).toEqual({ probability: 0.91, model: key.model, usage: zeroUsage })
    const raw = await readFile(cache.pathFor(key), 'utf8')
    expect(raw).not.toContain(key.problem)
    expect(raw).not.toContain(key.result)
  })

  it('reuses raw probability across threshold policy changes and treats corrupt cache as a miss', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-jev-cache-hit-'))
    roots.push(root)
    let calls = 0
    const client: JevClientFactory = async () => ({ evaluate: async () => { calls += 1; return wire(0.95) } })
    const first = new JevProgressEvaluator(
      resolvedConfig({ progressEvaluatorMode: 'jev', cacheEnabled: true, dataDir: root, jevCompletionThreshold: 0.9 }),
      async () => 'key', new JevProgressCache(root), client,
    )
    const request = { problem: 'task', steps: ['result'], checkpointSteps: [1], repeat: 0, signal: new AbortController().signal }
    expect((await first.evaluate(request)).cacheHit).toBe(false)
    const second = new JevProgressEvaluator(
      resolvedConfig({ progressEvaluatorMode: 'jev', cacheEnabled: true, dataDir: root, jevCompletionThreshold: 0.99 }),
      async () => 'key', new JevProgressCache(root), client,
    )
    expect((await second.evaluate(request)).cacheHit).toBe(true)
    expect(calls).toBe(1)

    const key: JevProgressCacheKey = {
      schemaVersion: 'jev-final-noul-v1', provider: 'typesafe-jev-noul-v1', model: 'jev-1.13.0',
      problem: 'corrupt', result: '=== Observed step 1 ===\nresult', repeat: 0,
    }
    const cache = new JevProgressCache(root)
    await mkdir(join(root, 'jev-progress-cache', 'v1', jevProgressCacheDigest(key).slice(0, 2)), { recursive: true })
    await writeFile(cache.pathFor(key), '{broken')
    expect(await cache.get(key)).toBeUndefined()
  })

  it('keeps existing mode available on Node 22 and gates Jev modes to Node 24', () => {
    expect(() => assertJevRuntime('existing', '22.19.0')).not.toThrow()
    expect(() => assertJevRuntime('jev-shadow', '22.19.0')).toThrow(/Node.js 24/)
    expect(() => assertJevRuntime('jev', '24.0.0')).not.toThrow()
  })
})
