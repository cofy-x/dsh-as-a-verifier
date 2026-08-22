/** Serializable configuration for dsh-as-a-verifier. @module dsh-as-a-verifier/config */

import z from '@deepseek-ai/schemastery'

/** Initial scaffold configuration. */
export interface Config {}

/** Loader-visible configuration schema. */
export const Config = z.object({}) as z<Config>
