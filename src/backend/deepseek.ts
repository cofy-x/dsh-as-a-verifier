/** Strict DeepSeek chat-completions backend. @module dsh-as-a-verifier/backend/deepseek */

import type { ResolvedConfig } from '../config.ts'
import type { TokenDistribution } from '../reward/score.ts'
import { VerifierError, type VerifierUsage } from '../types.ts'

export interface BackendScoreRequest {
  readonly prompt: string
  readonly signal?: AbortSignal
}

export interface BackendScoreResponse {
  readonly distribution: TokenDistribution
  readonly usage: VerifierUsage
}

export interface VerifierBackend {
  readonly id: string
  readonly model: string
  score(request: BackendScoreRequest): Promise<BackendScoreResponse>
}

export interface DeepSeekBackendOptions {
  readonly config: ResolvedConfig
  readonly resolveApiKey: () => Promise<string | undefined>
  readonly fetch?: typeof globalThis.fetch
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}

type JsonObject = Record<string, unknown>

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new VerifierError(`DeepSeek returned invalid ${label}`, 'INVALID_RESPONSE')
  }
  return value as JsonObject
}

function natural(value: unknown, field: string, optional = false): number {
  if (value === undefined && optional) return 0
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new VerifierError(`DeepSeek returned invalid ${field}`, 'INVALID_USAGE')
  }
  return value
}

function parseUsage(raw: unknown): VerifierUsage {
  const usage = object(raw, 'usage')
  const promptDetails = usage.prompt_tokens_details === undefined
    ? {}
    : object(usage.prompt_tokens_details, 'prompt token details')
  const completionDetails = usage.completion_tokens_details === undefined
    ? {}
    : object(usage.completion_tokens_details, 'completion token details')
  const inputTokens = natural(usage.prompt_tokens, 'prompt token usage')
  const cachedInputTokens = promptDetails.cached_tokens === undefined
    ? natural(usage.prompt_cache_hit_tokens, 'cached prompt token usage', true)
    : natural(promptDetails.cached_tokens, 'cached prompt token usage')
  if (cachedInputTokens > inputTokens) throw new VerifierError('DeepSeek cached input tokens exceed input tokens', 'INVALID_USAGE')
  return {
    calls: 1,
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens: inputTokens - cachedInputTokens,
    outputTokens: natural(usage.completion_tokens, 'completion token usage'),
    reasoningTokens: natural(completionDetails.reasoning_tokens, 'reasoning token usage', true),
    cacheHitRate: inputTokens === 0 ? 0 : cachedInputTokens / inputTokens,
  }
}

function parseDistribution(raw: unknown): TokenDistribution {
  const root = object(raw, 'JSON body')
  if (!Array.isArray(root.choices) || root.choices.length === 0) {
    throw new VerifierError('DeepSeek response omitted choices', 'INVALID_RESPONSE')
  }
  const choice = object(root.choices[0], 'choice')
  const logprobs = object(choice.logprobs, 'choice logprobs')
  if (!Array.isArray(logprobs.content) || logprobs.content.length === 0) {
    throw new VerifierError('DeepSeek returned no answer logprobs', 'MISSING_LOGPROBS')
  }
  const tokens: string[] = []
  const positionLogprobs: { token: string, logprob: number }[][] = []
  for (const rawPosition of logprobs.content) {
    const position = object(rawPosition, 'logprob position')
    if (typeof position.token !== 'string' || typeof position.logprob !== 'number' || !Number.isFinite(position.logprob)) {
      throw new VerifierError('DeepSeek returned an invalid chosen token logprob', 'INVALID_LOGPROBS')
    }
    tokens.push(position.token)
    const rawAlternatives = Array.isArray(position.top_logprobs) && position.top_logprobs.length > 0
      ? position.top_logprobs
      : [position]
    const alternatives = rawAlternatives.map((rawAlternative) => {
      const alternative = object(rawAlternative, 'top logprob')
      if (typeof alternative.token !== 'string' || typeof alternative.logprob !== 'number' || !Number.isFinite(alternative.logprob)) {
        throw new VerifierError('DeepSeek returned an invalid top logprob', 'INVALID_LOGPROBS')
      }
      return { token: alternative.token, logprob: alternative.logprob }
    })
    positionLogprobs.push(alternatives)
  }
  return { tokens, positionLogprobs }
}

function retryAfter(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')
  if (raw === null) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1_000)
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? Math.min(60_000, Math.max(0, timestamp - Date.now())) : undefined
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Native-fetch DeepSeek backend with bounded transient retry. */
export class DeepSeekBackend implements VerifierBackend {
  readonly id = 'deepseek-chat-completions-v1'
  readonly model: string
  private readonly config: ResolvedConfig
  private readonly resolveApiKey: () => Promise<string | undefined>
  private readonly fetcher: typeof globalThis.fetch
  private readonly sleeper: (milliseconds: number, signal: AbortSignal) => Promise<void>

  constructor(options: DeepSeekBackendOptions) {
    this.config = options.config
    this.model = options.config.model
    this.resolveApiKey = options.resolveApiKey
    this.fetcher = options.fetch ?? globalThis.fetch
    this.sleeper = options.sleep ?? wait
  }

  async score(request: BackendScoreRequest): Promise<BackendScoreResponse> {
    const operationController = new AbortController()
    const onAbort = (): void => { operationController.abort(request.signal?.reason) }
    if (request.signal?.aborted === true) onAbort()
    else request.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      for (let attempt = 1; attempt <= this.config.retryAttempts; attempt += 1) {
        // Resolve immediately before every HTTP request so credential rotation
        // also takes effect between retry attempts.
        const apiKey = (await this.resolveApiKey())?.trim()
        if (apiKey === undefined || apiKey.length === 0) {
          throw new VerifierError(`credential ${this.config.apiKeyEnv} is not configured`, 'MISSING_CREDENTIAL')
        }
        const attemptController = new AbortController()
        const propagate = (): void => { attemptController.abort(operationController.signal.reason) }
        operationController.signal.addEventListener('abort', propagate, { once: true })
        const timer = setTimeout(() => {
          attemptController.abort(new VerifierError('DeepSeek request timed out', 'REQUEST_TIMEOUT'))
        }, this.config.requestTimeoutMs)
        try {
          const response = await this.fetcher(`${this.config.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${apiKey}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: this.config.model,
              messages: [{ role: 'user', content: request.prompt }],
              max_tokens: this.config.maxTokens,
              temperature: 1,
              stream: false,
              logprobs: true,
              top_logprobs: 20,
              thinking: { type: this.config.reasoningEffort === 'off' ? 'disabled' : 'enabled' },
              ...(this.config.reasoningEffort === 'off' ? {} : { reasoning_effort: this.config.reasoningEffort }),
            }),
            signal: attemptController.signal,
          })
          if (!response.ok) {
            const transient = response.status === 429 || response.status >= 500
            if (transient && attempt < this.config.retryAttempts) {
              await this.sleeper(retryAfter(response) ?? Math.min(4_000, 250 * 2 ** (attempt - 1)), operationController.signal)
              continue
            }
            throw new VerifierError(`DeepSeek request failed with HTTP ${response.status}`, `HTTP_${response.status}`)
          }
          let body: unknown
          try {
            body = await response.json()
          } catch (error) {
            throw new VerifierError('DeepSeek returned malformed JSON', 'INVALID_JSON', { cause: error })
          }
          return { distribution: parseDistribution(body), usage: parseUsage(object(body, 'JSON body').usage) }
        } catch (error) {
          if (operationController.signal.aborted) {
            throw new VerifierError('verifier operation was cancelled', 'CANCELLED', { cause: error })
          }
          if (error instanceof VerifierError) throw error
          if (attempt >= this.config.retryAttempts) {
            const timedOut = attemptController.signal.aborted
            throw new VerifierError(timedOut ? 'DeepSeek request timed out' : 'DeepSeek transport failed', timedOut ? 'REQUEST_TIMEOUT' : 'TRANSPORT_ERROR', { cause: error })
          }
          await this.sleeper(Math.min(4_000, 250 * 2 ** (attempt - 1)), operationController.signal)
        } finally {
          clearTimeout(timer)
          operationController.signal.removeEventListener('abort', propagate)
        }
      }
      throw new VerifierError('DeepSeek retry budget exhausted', 'TRANSPORT_ERROR')
    } finally {
      request.signal?.removeEventListener('abort', onAbort)
    }
  }
}
