import { describe, expect, it, vi } from 'vitest'
import { DeepSeekBackend } from '../src/backend/deepseek.ts'
import { resolvedConfig } from './helpers.ts'

function validBody() {
  return {
    choices: [{
      message: { content: '<score_A> A </score_A>\n<score_B> T </score_B>' },
      logprobs: { content: [
        { token: '<score_A>', logprob: 0, top_logprobs: [] },
        { token: ' A', logprob: 0, top_logprobs: [{ token: ' A', logprob: 0 }] },
      ] },
    }],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 4 },
      completion_tokens_details: { reasoning_tokens: 2 },
    },
  }
}

describe('DeepSeek backend', () => {
  it('sends the exact verifier controls and parses usage', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(validBody()), { status: 200 }))
    const backend = new DeepSeekBackend({
      config: resolvedConfig(),
      resolveApiKey: async () => 'secret-key',
      fetch: fetcher,
    })
    const response = await backend.score({ prompt: 'PROMPT' })
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(init.headers).toEqual({ authorization: 'Bearer secret-key', 'content-type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'PROMPT' }],
      max_tokens: 32_768,
      temperature: 1,
      stream: false,
      logprobs: true,
      top_logprobs: 20,
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    })
    expect(response.usage).toEqual({
      calls: 1, inputTokens: 12, cachedInputTokens: 4, uncachedInputTokens: 8,
      outputTokens: 5, reasoningTokens: 2, cacheHitRate: 1 / 3,
    })
  })

  it('re-resolves credentials while retrying 429 and respects Retry-After', async () => {
    const keys = ['first-key', 'rotated-key']
    const sleeps: number[] = []
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(validBody()), { status: 200 }))
    const backend = new DeepSeekBackend({
      config: resolvedConfig(),
      resolveApiKey: async () => keys.shift(),
      fetch: fetcher,
      sleep: async milliseconds => { sleeps.push(milliseconds) },
    })
    await backend.score({ prompt: 'PROMPT' })
    expect(sleeps).toEqual([0])
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer first-key' })
    expect((fetcher.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer rotated-key' })
  })

  it('retries HTTP 5xx but not a missing credential', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(validBody()), { status: 200 }))
    const backend = new DeepSeekBackend({
      config: resolvedConfig(), resolveApiKey: async () => 'key', fetch: fetcher,
      sleep: async () => {},
    })
    await expect(backend.score({ prompt: 'PROMPT' })).resolves.toBeDefined()
    expect(fetcher).toHaveBeenCalledTimes(2)

    const absentFetch = vi.fn()
    const absent = new DeepSeekBackend({
      config: resolvedConfig(), resolveApiKey: async () => undefined, fetch: absentFetch,
    })
    await expect(absent.score({ prompt: 'PROMPT' })).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(absentFetch).not.toHaveBeenCalled()
  })

  it('does not retry authentication, protocol, or content failures and never exposes the key', async () => {
    for (const response of [
      new Response('', { status: 401 }),
      new Response('{broken', { status: 200 }),
      new Response(JSON.stringify({ ...validBody(), choices: [{ logprobs: { content: [] } }] }), { status: 200 }),
    ]) {
      const fetcher = vi.fn(async () => response)
      const backend = new DeepSeekBackend({
        config: resolvedConfig(), resolveApiKey: async () => 'do-not-leak-me', fetch: fetcher,
      })
      let diagnostic = ''
      try { await backend.score({ prompt: 'PROMPT' }) } catch (error) { diagnostic = String(error) }
      expect(diagnostic).not.toContain('do-not-leak-me')
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })

  it('bounds timeouts and observes cancellation', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(init.signal?.reason) }, { once: true })
    }))
    const backend = new DeepSeekBackend({
      config: resolvedConfig({ requestTimeoutMs: 5, retryAttempts: 1 }),
      resolveApiKey: async () => 'key', fetch: fetcher as unknown as typeof fetch,
    })
    await expect(backend.score({ prompt: 'PROMPT' })).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
    const controller = new AbortController()
    const task = backend.score({ prompt: 'PROMPT', signal: controller.signal })
    controller.abort()
    await expect(task).rejects.toMatchObject({ code: 'CANCELLED' })
  })
})
