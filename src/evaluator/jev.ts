/** Experimental TypeSafe Jev final-completion evaluator. */

import type { ResolvedConfig } from '../config.ts'
import { JevProgressCache, type JevProgressCacheKey } from '../cache/jev-progress-cache.ts'
import type { ProgressEvaluation, ProgressEvaluationRequest, ProgressEvaluator } from './progress.ts'
import { VerifierError, type VerifierUsage } from '../types.ts'

export const JEV_PROGRESS_SCHEMA_VERSION = 'jev-final-noul-v1'

const zeroUsage: VerifierUsage = Object.freeze({
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheHitRate: 0,
})

interface JevWireResult {
  readonly model: unknown
  readonly answers: unknown
  readonly usage: unknown
}

export interface JevClient {
  evaluate(request: {
    readonly state: { readonly objective: string, readonly result: string }
    readonly model: string
    readonly signal: AbortSignal
    readonly timeoutMs: number
    readonly maxRetries: number
  }): Promise<JevWireResult>
}

export type JevClientFactory = (options: {
  readonly apiKey: string
  readonly baseURL: string
}) => Promise<JevClient>

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new VerifierError(`Jev returned invalid ${label}`, 'JEV_INVALID_RESPONSE')
  }
  return value as Record<string, unknown>
}

function natural(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new VerifierError(`Jev returned invalid ${field}`, 'JEV_INVALID_USAGE')
  }
  return value
}

function parseResult(value: unknown, expectedModel: string): { probability: number, model: string, usage: VerifierUsage } {
  const raw = object(value, 'response')
  if (typeof raw.model !== 'string' || raw.model !== expectedModel) {
    throw new VerifierError(`Jev returned unexpected model (expected ${expectedModel})`, 'JEV_MODEL_MISMATCH')
  }
  const answers = object(raw.answers, 'answers')
  const complete = object(answers.complete, 'complete answer')
  if (complete.type !== 'noul' || typeof complete.noul !== 'number' || !Number.isFinite(complete.noul) || complete.noul < 0 || complete.noul > 1) {
    throw new VerifierError('Jev returned invalid completion probability', 'JEV_INVALID_RESPONSE')
  }
  const usage = object(raw.usage, 'usage')
  const inputTokens = natural(usage.input_tokens, 'input token usage')
  const outputTokens = natural(usage.output_tokens, 'output token usage')
  return {
    probability: complete.noul,
    model: raw.model,
    usage: {
      calls: 1,
      inputTokens,
      cachedInputTokens: 0,
      uncachedInputTokens: inputTokens,
      outputTokens,
      reasoningTokens: 0,
      cacheHitRate: 0,
    },
  }
}

async function defaultClientFactory(options: { apiKey: string, baseURL: string }): Promise<JevClient> {
  assertJevRuntime('jev')
  const { TypeSafeClient, noul } = await import('@typesafe-ai/sdk')
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    logLevel: 'off',
    retry: { maxRetries: 0 },
  })
  return {
    async evaluate(request) {
      return client.systemOne({
        state: request.state,
        model: request.model,
        questions: {
          complete: noul(
            'Has the agent substantively completed the objective, with direct evidence that every material requirement is satisfied?',
            {
              true: 'The result satisfies the objective and its material constraints, with observed verification rather than an unsupported claim.',
              false: 'The result is partial, broken, unverified, contradicted by evidence, or leaves any material requirement unresolved.',
            },
          ),
        },
      }, {
        signal: request.signal,
        timeout: request.timeoutMs,
        retry: { maxRetries: request.maxRetries },
      })
    },
  }
}

class Semaphore {
  private active = 0
  private readonly waiting: (() => void)[] = []
  constructor(private readonly limit: number) {}
  async run<T>(signal: AbortSignal, body: () => Promise<T>): Promise<T> {
    if (signal.aborted) throw new VerifierError('verifier operation was cancelled', 'CANCELLED')
    if (this.active >= this.limit) await new Promise<void>((resolve, reject) => {
      const resume = (): void => { signal.removeEventListener('abort', abort); resolve() }
      const abort = (): void => {
        const index = this.waiting.indexOf(resume)
        if (index >= 0) this.waiting.splice(index, 1)
        reject(new VerifierError('verifier operation was cancelled', 'CANCELLED'))
      }
      this.waiting.push(resume)
      signal.addEventListener('abort', abort, { once: true })
    })
    else this.active += 1
    try { return await body() } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active -= 1
    }
  }
}

function trajectoryResult(steps: readonly string[]): string {
  return steps.map((step, index) => `=== Observed step ${index + 1} ===\n${step}`).join('\n\n')
}

function sdkErrorCode(error: unknown): string {
  if (error === null || typeof error !== 'object') return 'JEV_SDK_ERROR'
  const name = 'name' in error && typeof error.name === 'string' ? error.name : ''
  if (name === 'APITimeoutError') return 'JEV_REQUEST_TIMEOUT'
  if (name === 'AuthenticationError' || name === 'PermissionDeniedError') return 'JEV_AUTHENTICATION_ERROR'
  if (name === 'RateLimitError') return 'JEV_RATE_LIMITED'
  if (name === 'BadRequestError' || name === 'UnprocessableEntityError' || name === 'NotFoundError') return 'JEV_REQUEST_REJECTED'
  if (name === 'APIConnectionError') return 'JEV_CONNECTION_ERROR'
  return 'JEV_SDK_ERROR'
}

export class JevProgressEvaluator implements ProgressEvaluator {
  readonly id = 'typesafe-jev-noul-v1'
  readonly model: string
  readonly finalCheckpointOnly = true
  private readonly semaphore: Semaphore

  constructor(
    private readonly config: ResolvedConfig,
    private readonly resolveApiKey: () => Promise<string | undefined>,
    private readonly cache = new JevProgressCache(config.dataDir, config.cacheEnabled),
    private readonly createClient: JevClientFactory = defaultClientFactory,
  ) {
    this.model = config.jevModel
    this.semaphore = new Semaphore(config.jevMaxConcurrency)
  }

  async evaluate(request: ProgressEvaluationRequest): Promise<ProgressEvaluation> {
    if (typeof request.problem !== 'string' || request.problem.trim().length === 0
      || !Array.isArray(request.steps) || request.steps.length === 0
      || request.steps.length > this.config.maxProgressSteps
      || request.steps.some(step => typeof step !== 'string' || !step.trim() || step.length > this.config.maxProgressStepChars)
      || request.steps.reduce((sum, step) => sum + step.length, 0) > this.config.maxProgressTrajectoryChars
      || !Number.isSafeInteger(request.repeat) || request.repeat < 0) {
      throw new VerifierError('invalid Jev progress request', 'INVALID_ARGUMENT')
    }
    if (request.checkpointSteps.length !== 1 || request.checkpointSteps[0] !== request.steps.length) {
      throw new VerifierError('Jev progress evaluation currently supports only the final checkpoint', 'JEV_FINAL_CHECKPOINT_ONLY')
    }
    if (request.signal.aborted) throw new VerifierError('verifier operation was cancelled', 'CANCELLED')
    const result = trajectoryResult(request.steps)
    const key: JevProgressCacheKey = {
      schemaVersion: JEV_PROGRESS_SCHEMA_VERSION,
      provider: this.id,
      model: this.model,
      problem: request.problem,
      result,
      repeat: request.repeat,
    }
    const cached = await this.cache.get(key)
    if (request.signal.aborted) throw new VerifierError('verifier operation was cancelled', 'CANCELLED')
    if (cached !== undefined && cached.model === this.model) {
      return { scores: [cached.probability], probability: cached.probability, provider: this.id, model: cached.model, latencyMs: 0, cacheHit: true, usage: zeroUsage }
    }
    return this.semaphore.run(request.signal, async () => {
      if (request.signal.aborted) throw new VerifierError('verifier operation was cancelled', 'CANCELLED')
      const late = await this.cache.get(key)
      if (request.signal.aborted) throw new VerifierError('verifier operation was cancelled', 'CANCELLED')
      if (late !== undefined && late.model === this.model) {
        return { scores: [late.probability], probability: late.probability, provider: this.id, model: late.model, latencyMs: 0, cacheHit: true, usage: zeroUsage }
      }
      const apiKey = (await this.resolveApiKey())?.trim()
      if (request.signal.aborted) throw new VerifierError('verifier operation was cancelled', 'CANCELLED')
      if (apiKey === undefined || apiKey.length === 0) {
        throw new VerifierError(`credential ${this.config.jevApiKeyEnv} is not configured`, 'JEV_MISSING_CREDENTIAL')
      }
      const controller = new AbortController()
      const onAbort = (): void => { controller.abort(request.signal.reason) }
      request.signal.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => controller.abort(new VerifierError('Jev request timed out', 'JEV_REQUEST_TIMEOUT')), this.config.jevTimeoutMs)
      const started = performance.now()
      try {
        const client = await this.createClient({ apiKey, baseURL: this.config.jevBaseURL })
        controller.signal.throwIfAborted()
        const raw = await client.evaluate({
          state: { objective: request.problem, result },
          model: this.model,
          signal: controller.signal,
          timeoutMs: this.config.jevTimeoutMs,
          maxRetries: this.config.jevRetryAttempts - 1,
        })
        controller.signal.throwIfAborted()
        const parsed = parseResult(raw, this.model)
        await this.cache.set(key, parsed)
        return {
          scores: [parsed.probability],
          probability: parsed.probability,
          provider: this.id,
          model: parsed.model,
          latencyMs: performance.now() - started,
          cacheHit: false,
          usage: parsed.usage,
        }
      } catch (error) {
        if (request.signal.aborted) throw new VerifierError('verifier operation was cancelled', 'CANCELLED')
        if (controller.signal.aborted) throw new VerifierError('Jev request timed out', 'JEV_REQUEST_TIMEOUT')
        if (error instanceof VerifierError) throw error
        const code = sdkErrorCode(error)
        // SDK errors may retain response bodies, headers, and task content.
        throw new VerifierError(code === 'JEV_REQUEST_TIMEOUT' ? 'Jev request timed out' : 'Jev evaluation failed', code)
      } finally {
        clearTimeout(timer)
        request.signal.removeEventListener('abort', onAbort)
      }
    })
  }
}

export function assertJevRuntime(mode: ResolvedConfig['progressEvaluatorMode'], nodeVersion = process.versions.node): void {
  if (mode === 'existing') return
  const major = Number(nodeVersion.split('.')[0])
  if (!Number.isSafeInteger(major) || major < 24) {
    throw new Error('dsh-as-a-verifier: Jev experiment requires Node.js 24 or newer because SDK cancellation is unsafe on Node 20/22')
  }
}
