/** Cordis activation boundary for dsh-as-a-verifier. @module dsh-as-a-verifier/runtime */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { DeepSeekBackend } from './backend/deepseek.ts'
import { ScoreCache } from './cache/score-cache.ts'
import { ProgressCache } from './cache/progress-cache.ts'
import { resolveConfig, type Config } from './config.ts'
import { VerifierService } from './service.ts'
import { registerVerifierTools } from './tools.ts'
import { VerifierError, type VerifierServiceApi } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Pairwise fine-grained reward and PPT selection service. */
    verifier: VerifierServiceApi
  }
}

/** Activate the service, tool registration, cache, and cancellation lifecycle. */
export function apply(ctx: Context, config: Config): void {
  const environment = launchEnvironmentOf(ctx)
  const resolved = resolveConfig(config, environment)
  const resolveApiKey = async (): Promise<string | undefined> => {
    const credentials = ctx.get('credentials') as { resolve(ref: string): Promise<{ value: string } | undefined> } | undefined
    const raw = credentials === undefined
      ? environment.get(resolved.apiKeyEnv)?.value
      : (await credentials.resolve(resolved.apiKeyEnv))?.value
    const value = raw?.trim()
    if (value === undefined || value.length === 0) return undefined
    if (!/^[\x21-\x7e]+$/u.test(value)) {
      throw new VerifierError(`credential ${resolved.apiKeyEnv} contains invalid characters`, 'INVALID_CREDENTIAL')
    }
    return value
  }
  const backend = new DeepSeekBackend({ config: resolved, resolveApiKey })
  const cache = new ScoreCache(resolved.dataDir, resolved.cacheEnabled)
  const verifier = new VerifierService(resolved, backend, cache, new ProgressCache(resolved.dataDir, resolved.cacheEnabled))
  ctx.provide('verifier', verifier)
  registerVerifierTools(ctx, verifier)
  ctx.effect(() => async () => { await verifier.dispose() }, 'dsh-as-a-verifier: operations')
}
