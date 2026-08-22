/** Fine-grained verification for DeepSeek Harness. @module dsh-as-a-verifier */

export const name = 'dsh-as-a-verifier'

/** Services required before this plugin applies. */
export const inject = ['tools']

export { Config } from './config.ts'
export type { Config as PluginConfig } from './config.ts'
export { apply } from './runtime.ts'
