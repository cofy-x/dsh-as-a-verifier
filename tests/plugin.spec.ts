import Loader from '@deepseek-ai/cordis-plugin-loader'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import { createPluginHarness } from './harness.ts'

const criterion = { id: 'correct', name: 'Correctness', description: 'Judge correctness.' }

describe('dsh-as-a-verifier plugin', () => {
  it('preserves the function-plugin namespace through Loader unwrapping', () => {
    expect('default' in plugin).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(plugin) as Record<string, unknown>
    expect(unwrapped).toBe(plugin)
    expect(unwrapped.name).toBe('dsh-as-a-verifier')
    expect(unwrapped.inject).toEqual(['tools'])
    expect(unwrapped.Config).toBeDefined()
    expect(typeof unwrapped.apply).toBe('function')
  })

  it('mounts ctx.verifier and the keyless canonical tool, then removes both', async () => {
    const harness = await createPluginHarness()
    expect(harness.ctx.get('verifier')).toBeDefined()
    expect(harness.tools.map(tool => tool.name)).toEqual(['verifier_select'])
    const tool = harness.tools[0]
    const result = await tool?.execute({
      problem: 'Choose one.', candidates: ['only candidate'], criteria: [criterion], seed: 9,
    }, { signal: new AbortController().signal } as never)
    expect(result).toEqual({
      selectedIndex: 0,
      best: 'only candidate',
      ranking: [0],
      scores: [{ index: 0, score: 1 }],
      comparisonCount: 0,
      verifierCalls: 0,
      criteria: [criterion],
      usage: {
        calls: 0, inputTokens: 0, cachedInputTokens: 0, uncachedInputTokens: 0,
        outputTokens: 0, reasoningTokens: 0, cacheHitRate: 0,
      },
    })
    const snapshot = await readFile(new URL('snapshots/keyless-tool-output.json', import.meta.url), 'utf8')
    expect(`${JSON.stringify(result, null, 2)}\n`).toBe(snapshot)
    expect(tool?.presentCall?.({ problem: 'Choose one.', candidates: ['only'], criteria: [criterion] })).toEqual({
      card: 'generic', title: 'Verify and select candidate', kind: 'execute', rawInput: 'Choose one.',
    })
    await harness.fiber.dispose()
    expect(harness.ctx.get('verifier')).toBeUndefined()
    expect(harness.tools).toEqual([])
  })

  it('aborts an in-flight request and reaches quiescence on fiber disposal', async () => {
    const originalFetch = globalThis.fetch
    let active = 0
    let started!: () => void
    const didStart = new Promise<void>(resolve => { started = resolve })
    globalThis.fetch = vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      active += 1
      started()
      init?.signal?.addEventListener('abort', () => {
        active -= 1
        reject(init.signal?.reason)
      }, { once: true })
    })) as typeof fetch
    try {
      const harness = await createPluginHarness({ retryAttempts: 1 })
      const operation = harness.ctx.verifier.compare({
        problem: 'task', traceA: 'a', traceB: 'b', criteria: [criterion], nEvaluations: 1,
      })
      await didStart
      await harness.fiber.dispose()
      await expect(operation).rejects.toMatchObject({ code: 'CANCELLED' })
      expect(active).toBe(0)
      expect(harness.tools).toEqual([])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
